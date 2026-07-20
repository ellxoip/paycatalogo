import prisma from '../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import { catalogService, productoDisponible } from './catalog.service.js';
import { providerRegistry } from '../providers/index.js';
import { logger } from '../lib/logger.js';
import { outboxService } from './outbox.service.js';
import { publishOrderPaid, type OrderPaidPayload } from '../workers/orderPaidHandler.js';
import type { IPaymentProvider, ProviderName } from '../providers/types.js';
import type {
  CreateOrderRequest,
  WebhookProviderPayload,
} from '../types/index.js';

const APP_URL = process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:4000');

// Precio del catálogo es texto libre ("$12.990", "12990", null) — se toma el
// primer número que aparezca; sin match o sin precio publicado, el producto
// no se puede vender (el dueño lo confirma en la conversación, no en el carrito).
function parsePrecio(precio: string | null): number | null {
  if (!precio) return null;
  const match = precio.replace(/\./g, '').replace(/,/g, '.').match(/\d+(\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

export class PaymentService {

  // ===========================================================
  // 1. Crear pedido (carrito -> Order + OrderItem) + intención de pago
  // ===========================================================
  async createOrderWithPaymentIntent(data: CreateOrderRequest) {
    if (!data.pyme_id) {
      throw { message: 'pyme_id es requerido', status: 400, code: 'MISSING_PYME_ID' };
    }
    if (!data.items?.length) {
      throw { message: 'El carrito está vacío', status: 400, code: 'EMPTY_CART' };
    }

    // Con no-disponibles incluidos, para distinguir "no existe" de "agotado/pausado"
    // (regla de disponibilidad espejo de Fase 4j en zelix).
    const catalog = await catalogService.getCatalog(data.pyme_id, { incluirNoDisponibles: true });
    if (!catalog) {
      throw { message: 'PYME o catálogo no encontrado', status: 404, code: 'CATALOG_NOT_FOUND' };
    }

    const productMap = new Map(catalog.productos.map((producto) => [producto.id, producto]));
    const orderItems: Array<{ product_id: string; nombre_snapshot: string; precio_snapshot: number; cantidad: number }> = [];

    for (const item of data.items) {
      const producto = productMap.get(item.product_id);
      if (!producto) {
        throw { message: `Producto "${item.product_id}" no existe en el catálogo`, status: 400, code: 'PRODUCT_NOT_FOUND' };
      }
      if (!productoDisponible(producto)) {
        throw { message: `"${producto.nombre}" no está disponible en este momento`, status: 400, code: 'PRODUCT_UNAVAILABLE' };
      }
      const cantidad = Math.max(1, Math.floor(item.cantidad || 1));
      if (typeof producto.stock === 'number' && cantidad > producto.stock) {
        throw { message: `"${producto.nombre}" solo tiene ${producto.stock} unidad(es) disponible(s)`, status: 400, code: 'INSUFFICIENT_STOCK' };
      }
      const precio = parsePrecio(producto.precio);
      if (precio === null) {
        throw { message: `"${producto.nombre}" no tiene precio publicado — no se puede agregar al carrito`, status: 400, code: 'PRODUCT_WITHOUT_PRICE' };
      }
      orderItems.push({ product_id: producto.id, nombre_snapshot: producto.nombre, precio_snapshot: precio, cantidad });
    }

    const total = orderItems.reduce((acc, item) => acc + item.precio_snapshot * item.cantidad, 0);

    const order = await prisma.order.create({
      data: {
        pyme_id: data.pyme_id,
        cliente_nombre: data.cliente_nombre || null,
        cliente_telefono: data.cliente_telefono || null,
        cliente_email: data.cliente_email || null,
        cliente_chat_id: data.cliente_chat_id || null, // §10.8 2.2 — cadena de identidad
        canal_origen: data.canal_origen || null,
        moneda: catalog.moneda,
        total,
        status: 'creada',
        items: { create: orderItems },
      },
      include: { items: true },
    });

    const external_attempt_id = `zpay_attempt_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const providerName = this.resolveProviderName(data.provider);
    const provider: IPaymentProvider = providerRegistry.get(providerName);

    const description = orderItems.length === 1
      ? orderItems[0].nombre_snapshot
      : `${catalog.pyme_nombre} — ${orderItems.length} productos`;

    const providerResponse = await provider.createTransaction({
      external_attempt_id,
      amount: total,
      currency: catalog.moneda,
      description,
      customer_email: data.cliente_email,
      customer_name: data.cliente_nombre,
      return_url: `${APP_URL}/api/payments/callback`,
      cancel_url: `${APP_URL}/api/payments/cancel`,
      notification_url: `${APP_URL}/api/webhooks/payment-provider`,
      metadata: {
        order_id: order.id,
        pyme_id: data.pyme_id,
        external_attempt_id,
      },
    });

    const attempt = await prisma.paymentAttempt.create({
      data: {
        external_attempt_id,
        order_id: order.id,
        amount: total,
        currency: catalog.moneda,
        provider: provider.name,
        status: 'iniciado',
        provider_transaction_id: providerResponse.provider_transaction_id,
        request_payload_json: { provider_raw: providerResponse.raw_response ?? null },
      },
    });

    return {
      order_id: order.id,
      attempt_id: attempt.id,
      external_attempt_id,
      provider: provider.name,
      provider_environment: provider.environment,
      payment_url: providerResponse.payment_url,
      total,
      moneda: catalog.moneda,
    };
  }

  // ===========================================================
  // 2. Callback del proveedor (confirm after redirect)
  // ===========================================================
  async processProviderCallback(token: string, providerName?: string) {
    const attempt = await prisma.paymentAttempt.findFirst({
      where: { provider_transaction_id: token },
    });

    if (!attempt) {
      throw { message: 'Transaction not found', status: 404, code: 'TRANSACTION_NOT_FOUND' };
    }

    const provider = providerRegistry.get((providerName || attempt.provider || 'flow') as ProviderName);
    const confirmation = await provider.confirmTransaction(token);

    await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        response_payload_json: confirmation.raw_response ?? null,
        method: confirmation.payment_method || null,
      },
    });

    if (confirmation.approved) {
      return this.processApprovedPayment(attempt, {
        external_attempt_id: attempt.external_attempt_id,
        provider_transaction_id: confirmation.provider_transaction_id,
        status: 'approved',
        amount: confirmation.amount || Number(attempt.amount),
        method: confirmation.payment_method,
        authorization_code: confirmation.authorization_code,
      });
    }

    return this.processRejectedPayment(attempt, {
      external_attempt_id: attempt.external_attempt_id,
      provider_transaction_id: confirmation.provider_transaction_id,
      status: 'rejected',
      amount: Number(attempt.amount),
      error_message: confirmation.reason,
      error_code: confirmation.error_code,
    });
  }

  // ===========================================================
  // 3. Webhooks del proveedor
  // ===========================================================
  async processWebhook(providerData: WebhookProviderPayload) {
    const attempt = await prisma.paymentAttempt.findUnique({
      where: { external_attempt_id: providerData.external_attempt_id },
    });

    if (!attempt) {
      throw { message: 'Payment attempt not found', status: 404, code: 'ATTEMPT_NOT_FOUND' };
    }

    if (providerData.status === 'approved') {
      return this.processApprovedPayment(attempt, providerData);
    }
    return this.processRejectedPayment(attempt, providerData);
  }

  async processProviderWebhook(providerName: string, headers: Record<string, string>, body: any, query: any) {
    const provider = providerRegistry.get(providerName as ProviderName);
    const signedBody = { ...body, query };
    if (!provider.validateWebhookSignature(headers, signedBody)) {
      throw { message: 'Invalid webhook signature', status: 401, code: 'INVALID_WEBHOOK_SIGNATURE' };
    }

    const paymentId = String(body?.token || query?.token || body?.token_ws || query?.token_ws || body?.provider_transaction_id || '');
    if (!paymentId) {
      throw { message: 'Missing provider payment id', status: 400, code: 'MISSING_PAYMENT_ID' };
    }

    const confirmation = await provider.confirmTransaction(paymentId);
    const externalAttemptId = this.extractExternalAttemptId(confirmation.raw_response);
    const attempt = externalAttemptId
      ? await prisma.paymentAttempt.findUnique({ where: { external_attempt_id: externalAttemptId } })
      : await prisma.paymentAttempt.findFirst({ where: { provider_transaction_id: paymentId } });

    if (!attempt) {
      throw { message: 'Payment attempt not found', status: 404, code: 'ATTEMPT_NOT_FOUND' };
    }

    await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        provider_transaction_id: confirmation.provider_transaction_id,
        response_payload_json: confirmation.raw_response ?? null,
        method: confirmation.payment_method || null,
      },
    });

    if (confirmation.approved) {
      return this.processApprovedPayment(attempt, {
        external_attempt_id: attempt.external_attempt_id,
        provider_transaction_id: confirmation.provider_transaction_id,
        status: 'approved',
        amount: confirmation.amount || Number(attempt.amount),
        method: confirmation.payment_method,
        authorization_code: confirmation.authorization_code,
      });
    }

    if (confirmation.status === 'pending') {
      return { status: 'pending', external_attempt_id: attempt.external_attempt_id };
    }

    return this.processRejectedPayment(attempt, {
      external_attempt_id: attempt.external_attempt_id,
      provider_transaction_id: confirmation.provider_transaction_id,
      status: 'rejected',
      amount: Number(attempt.amount),
      error_message: confirmation.reason,
      error_code: confirmation.error_code,
    });
  }

  // ===========================================================
  // 3a. Pago APROBADO
  // ===========================================================
  private async processApprovedPayment(attempt: any, providerData: WebhookProviderPayload) {
    const existing = await prisma.payment.findFirst({ where: { payment_attempt_id: attempt.id } });
    if (existing) {
      logger.info('Payment attempt already processed', { externalAttemptId: attempt.external_attempt_id });
      return existing;
    }

    await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'confirmado',
        provider_transaction_id: providerData.provider_transaction_id,
        method: providerData.method || null,
        provider_payload_json: providerData as unknown as Prisma.InputJsonValue,
      },
    });

    const external_payment_id = `zpay_pay_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const transactionNumber = providerData.authorization_code || providerData.provider_transaction_id;

    try {
      const payment = await prisma.payment.create({
        data: {
          external_payment_id,
          payment_attempt_id: attempt.id,
          provider: attempt.provider,
          provider_transaction_id: providerData.provider_transaction_id,
          transaction_number: transactionNumber,
          amount: attempt.amount,
          method: providerData.method || null,
          status: 'confirmado',
          paid_at: new Date(),
          raw_provider_payload_json: providerData as unknown as Prisma.InputJsonValue,
        },
      });

      await prisma.order.update({ where: { id: attempt.order_id }, data: { status: 'pagada' } });

      // Costura order.paid (§10.8 B) — avisar a Zelix: encolar en el outbox (durable,
      // idempotente por external_payment_id) + intento inline inmediato (best-effort).
      // Nunca bloquea ni revierte el pago: si Zelix está caído, el cron lo reintenta.
      await this.emitOrderPaid(attempt.order_id, external_payment_id, payment.paid_at);

      return payment;
    } catch (err: any) {
      if (err.code === 'P2002') {
        const existingPayment = await prisma.payment.findFirst({ where: { payment_attempt_id: attempt.id } });
        if (existingPayment) return existingPayment;
      }
      throw err;
    }
  }

  /** Costura order.paid (§10.8 B) — arma el payload, lo encola y hace un intento inline. */
  private async emitOrderPaid(orderId: string, externalPaymentId: string, paidAt: Date | null) {
    try {
      const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!order) return;
      const payload: OrderPaidPayload = {
        event: 'order.paid',
        external_payment_id: externalPaymentId,
        order_id: order.id,
        pyme_id: order.pyme_id,
        cliente_chat_id: order.cliente_chat_id ?? null, // §10.8 2.2 — cadena de identidad
        canal_origen: order.canal_origen ?? null,
        total: Number(order.total),
        moneda: order.moneda,
        paid_at: (paidAt ?? new Date()).toISOString(),
        items: order.items.map((i) => ({
          product_id: i.product_id,
          nombre_snapshot: i.nombre_snapshot,
          precio_snapshot: i.precio_snapshot != null ? String(i.precio_snapshot) : null,
          cantidad: i.cantidad,
        })),
      };
      const idempotencyKey = `order.paid:${externalPaymentId}`;
      await outboxService.enqueue({ eventType: 'order.paid', aggregateType: 'Order', aggregateId: order.id, idempotencyKey, payload });
      try {
        await publishOrderPaid(payload); // intento inline inmediato (best-effort)
        await outboxService.markPublished(idempotencyKey);
      } catch (e: any) {
        logger.warn('order.paid inline falló, queda para el cron', { orderId, error: e?.message || String(e) });
      }
    } catch (e: any) {
      logger.error('emitOrderPaid falló (no bloquea el pago)', { orderId, error: e?.message || String(e) });
    }
  }

  // ===========================================================
  // 3b. Pago RECHAZADO
  // ===========================================================
  private async processRejectedPayment(attempt: any, providerData: WebhookProviderPayload) {
    await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: 'rechazado',
        provider_transaction_id: providerData.provider_transaction_id || null,
        provider_payload_json: providerData as unknown as Prisma.InputJsonValue,
      },
    });

    return { status: 'rejected', external_attempt_id: attempt.external_attempt_id };
  }

  // ===========================================================
  // 4. Reversa
  // ===========================================================
  async processReversal(reversalData: { external_payment_id: string; provider_transaction_id: string; amount: number; reason: string; provider_reversal_code?: string }) {
    const { external_payment_id, provider_transaction_id, amount, reason, provider_reversal_code } = reversalData;

    const payment = await prisma.payment.findFirst({
      where: { OR: [{ external_payment_id }, { provider_transaction_id }] },
      include: { attempt: true },
    });

    if (!payment) {
      throw { message: 'Pago original no encontrado para reversa', status: 404, code: 'PAYMENT_NOT_FOUND' };
    }

    const existing = await prisma.paymentReversal.findFirst({ where: { external_payment_id: payment.external_payment_id } });
    if (existing) return existing;

    const external_reversal_id = `zpay_rev_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'reversado' } });
    await prisma.paymentAttempt.update({ where: { id: payment.attempt.id }, data: { status: 'reversado' } });
    await prisma.order.update({ where: { id: payment.attempt.order_id }, data: { status: 'cancelada' } });

    const reversal = await prisma.paymentReversal.create({
      data: {
        external_reversal_id,
        external_payment_id: payment.external_payment_id,
        external_attempt_id: payment.attempt.external_attempt_id,
        payment_id: payment.id,
        provider: payment.provider,
        amount_reversed: amount,
        reason,
        provider_reversal_code: provider_reversal_code || null,
        reversed_at: new Date(),
      },
    });

    try {
      const provider = providerRegistry.get(payment.provider as ProviderName);
      if (payment.provider_transaction_id) {
        await provider.refundTransaction(payment.provider_transaction_id, amount);
      }
    } catch (e: any) {
      logger.warn('Provider refund attempt failed', { externalPaymentId: payment.external_payment_id, error: e.message });
    }

    return reversal;
  }

  private extractExternalAttemptId(raw: any): string {
    const direct = raw?.external_reference || raw?.commerceOrder || raw?.buy_order || raw?.external_attempt_id;
    if (direct) return String(direct);

    const optional = raw?.optional;
    if (typeof optional === 'string') {
      try {
        const parsed = JSON.parse(optional);
        return String(parsed?.external_attempt_id || '');
      } catch {
        return '';
      }
    }
    if (optional && typeof optional === 'object') {
      return String(optional.external_attempt_id || '');
    }

    return '';
  }

  private resolveProviderName(requestedProvider?: string): ProviderName {
    const candidate = (requestedProvider || process.env.PAYMENT_DEFAULT_PROVIDER || 'simulator') as ProviderName;
    if (candidate === 'simulator') return 'simulator';
    return 'flow';
  }
}

export const paymentService = new PaymentService();
