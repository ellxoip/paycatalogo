import prisma from '../lib/prisma.js';
import { leerPrecioCatalogo, type MotivoPrecioNoCobrable } from '../../shared/precio.generado.js';
import type { Prisma } from '@prisma/client';
import { catalogService, productoDisponible } from './catalog.service.js';
import { providerRegistry } from '../providers/index.js';
import { logger } from '../lib/logger.js';
import { outboxService } from './outbox.service.js';
import { fraudGuard } from './fraudGuard.js';
import { publishOrderPaid, type OrderPaidPayload } from '../workers/orderPaidHandler.js';
import type { IPaymentProvider, ProviderName } from '../providers/types.js';
import type {
  CreateOrderRequest,
  WebhookProviderPayload,
} from '../types/index.js';

const APP_URL = process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:4000');

/**
 * Motivo legible para el cliente cuando un precio de catálogo NO se puede cobrar.
 *
 * Antes acá vivía un `parsePrecio` que tomaba el primer número del string: un
 * producto con precio "2 x $3.000" se cobraba a $2, y "5kg $4.990" a $5. Nunca
 * cobraba de más — siempre de menos, y la diferencia la perdía la pyme.
 *
 * Ahora la lectura la hace la sede única (`precio.generado.ts`, copia verificada
 * del repo zelix) y lo ambiguo se RECHAZA con motivo en vez de adivinarse. Un
 * checkout rechazado se arregla corrigiendo el catálogo; un cobro por $2 se
 * descubre cuando el producto ya salió por la puerta.
 */
const MOTIVO_PRECIO: Record<MotivoPrecioNoCobrable, string> = {
  sin_precio: 'no tiene precio publicado',
  rango: 'tiene un precio referencial (un rango), no un precio final',
  ambiguo: 'tiene más de un precio y no se puede saber cuál corresponde',
};

/** Huella de la request que crea la orden (para fraudGuard y auditoría). */
export interface OrderRequestContext {
  ip?: string;
  userAgent?: string | null;
}

export class PaymentService {

  // ===========================================================
  // 1. Crear pedido (carrito -> Order + OrderItem) + intención de pago
  // ===========================================================
  async createOrderWithPaymentIntent(data: CreateOrderRequest, requestContext: OrderRequestContext = {}) {
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
      const lectura = leerPrecioCatalogo(producto.precio);
      if (lectura.cobrable !== true) {
        throw {
          message: `"${producto.nombre}" ${MOTIVO_PRECIO[lectura.motivo]} — no se puede cobrar. Pídele el precio al vendedor.`,
          status: 400,
          code: 'PRODUCT_WITHOUT_PRICE',
        };
      }
      orderItems.push({ product_id: producto.id, nombre_snapshot: producto.nombre, precio_snapshot: lectura.valor, cantidad });
    }

    const total = orderItems.reduce((acc, item) => acc + item.precio_snapshot * item.cantidad, 0);

    // El proveedor se resuelve ANTES de escribir nada, para poder exigir lo que
    // ese proveedor necesita sin dejar una Order huérfana si falta un dato.
    const providerName = this.resolveProviderName(data.provider);
    const provider: IPaymentProvider = providerRegistry.get(providerName);

    // Flow valida el correo contra el dominio (exige MX real): sin correo del
    // comprador no hay transacción posible, y descubrirlo después de crear la
    // orden deja basura en la base y un 400 opaco en la cara del cliente.
    if (providerName === 'flow' && !data.cliente_email) {
      throw {
        message: 'Necesitamos tu correo para emitir el comprobante de pago.',
        status: 400,
        code: 'CUSTOMER_EMAIL_REQUIRED',
      };
    }

    // Antifraude ANTES de crear la orden y de abrir una transacción en Flow: una
    // transacción abierta ya cuesta (aparece en el panel del comercio y suma a la
    // tasa de rechazo aunque nadie la pague).
    await fraudGuard.assertOrderAllowed({
      ip: requestContext.ip || 'unknown',
      pymeId: data.pyme_id,
      amount: total,
      email: data.cliente_email,
      telefono: data.cliente_telefono,
    });

    const order = await prisma.order.create({
      data: {
        pyme_id: data.pyme_id,
        cliente_nombre: data.cliente_nombre || null,
        cliente_telefono: data.cliente_telefono || null,
        cliente_email: data.cliente_email || null,
        cliente_chat_id: data.cliente_chat_id || null, // §10.8 2.2 — cadena de identidad
        canal_origen: data.canal_origen || null,
        cliente_ip: requestContext.ip || null,
        cliente_user_agent: requestContext.userAgent || null,
        moneda: catalog.moneda,
        total,
        status: 'creada',
        items: { create: orderItems },
      },
      include: { items: true },
    });

    const external_attempt_id = `zpay_attempt_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

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

    if (confirmation.approved && this.assertAmountMatches(attempt, confirmation.amount, 'callback')) {
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
      error_message: confirmation.approved ? 'Monto confirmado no coincide con la orden' : confirmation.reason,
      error_code: confirmation.approved ? 'AMOUNT_MISMATCH' : confirmation.error_code,
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
      // Este webhook no viene firmado por ninguna pasarela: la ruta exige secreto
      // compartido (middleware/webhookAuth.ts) y aquí, además, el monto declarado
      // tiene que calzar con el de la orden. Nunca se aprueba por el body solo.
      if (!this.assertAmountMatches(attempt, providerData.amount, 'webhook-interno')) {
        throw { message: 'Amount mismatch', status: 400, code: 'AMOUNT_MISMATCH' };
      }
      return this.processApprovedPayment(attempt, { ...providerData, amount: Number(attempt.amount) });
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

    // Flow NO firma sus notificaciones: manda un `token` por POST y el patrón que
    // el propio Flow indica es re-consultar el estado. Como el token no prueba
    // nada por sí solo, primero se exige que corresponda a una transacción que
    // NOSOTROS abrimos. Sin esto, un tercero puede hacer que nuestro servidor
    // dispare llamadas salientes a Flow con tokens arbitrarios (sondeo de
    // transacciones ajenas y amplificación contra la API de la pasarela).
    const conocido = await prisma.paymentAttempt.findFirst({ where: { provider_transaction_id: paymentId } });
    if (!conocido) {
      logger.warn('Webhook de pasarela con token desconocido — descartado sin consultar a Flow', { provider: providerName });
      throw { message: 'Unknown provider payment id', status: 404, code: 'UNKNOWN_PAYMENT_ID' };
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

    if (confirmation.approved && this.assertAmountMatches(attempt, confirmation.amount, 'webhook')) {
      return this.processApprovedPayment(attempt, {
        external_attempt_id: attempt.external_attempt_id,
        provider_transaction_id: confirmation.provider_transaction_id,
        status: 'approved',
        amount: confirmation.amount || Number(attempt.amount),
        method: confirmation.payment_method,
        authorization_code: confirmation.authorization_code,
      });
    }

    if (confirmation.approved) {
      // Aprobado por la pasarela pero con monto que no calza: se marca rechazado
      // y queda el rastro para revisarlo a mano (§ blindaje de pagos).
      return this.processRejectedPayment(attempt, {
        external_attempt_id: attempt.external_attempt_id,
        provider_transaction_id: confirmation.provider_transaction_id,
        status: 'error',
        amount: Number(attempt.amount),
        error_message: 'Monto confirmado no coincide con la orden',
        error_code: 'AMOUNT_MISMATCH',
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

  /**
   * En producción el proveedor NO lo elige el cliente. Aceptar `provider` del
   * body significa que un `{"provider":"simulator"}` produce un pago aprobado
   * sin plata en cuanto alguien deje el simulador registrado (demo, prueba,
   * variable mal puesta). El body se ignora y manda la configuración del server.
   */
  private resolveProviderName(requestedProvider?: string): ProviderName {
    const isProduction = process.env.PAYMENT_ENVIRONMENT === 'production';
    if (isProduction) {
      if (requestedProvider && requestedProvider !== providerRegistry.getDefault().name) {
        logger.warn('Provider pedido por el cliente ignorado en producción', { requestedProvider });
      }
      return providerRegistry.getDefault().name;
    }

    const candidate = (requestedProvider || process.env.PAYMENT_DEFAULT_PROVIDER || 'simulator') as ProviderName;
    if (candidate === 'simulator') return 'simulator';
    return 'flow';
  }

  /**
   * El monto que confirma la pasarela debe ser el de la orden. Si difiere, el
   * pago NO se aprueba: o hay manipulación, o hay un desajuste de datos — en
   * ambos casos confirmarlo entrega mercadería contra un cobro que no calza.
   * (Los proveedores que no informan monto devuelven 0: eso no es discrepancia.)
   */
  private assertAmountMatches(attempt: any, reportedAmount: number | undefined, source: string): boolean {
    const expected = Number(attempt.amount);
    const reported = Number(reportedAmount || 0);
    if (!reported) return true;
    // Tolerancia de 1 unidad: CLP no tiene decimales, pero la pasarela puede
    // redondear distinto en monedas que sí.
    if (Math.abs(reported - expected) <= 1) return true;

    logger.error('Monto confirmado no coincide con la orden — pago NO aprobado', {
      source,
      externalAttemptId: attempt.external_attempt_id,
      expected,
      reported,
    });
    return false;
  }
}

export const paymentService = new PaymentService();
