/**
 * Costura order.paid (§10.8 B, sub-fase 2.1) — EMISOR: publica el evento
 * `order.paid` a Zelix. POST firmado con HMAC-SHA256 del raw body (mismo patrón
 * que el webhook de Meta, verificado del otro lado con `verifyMetaSignature`).
 * Lanza en cualquier no-2xx para que el OutboxService reintente (durabilidad).
 */
import { createHmac } from 'node:crypto';
import { logger } from '../lib/logger.js';

export interface OrderPaidPayload {
  event: 'order.paid';
  external_payment_id: string;
  order_id: string;
  pyme_id: string;
  cliente_chat_id: string | null;
  canal_origen: string | null;
  total: number;
  moneda: string;
  paid_at: string;
  items: { product_id: string; nombre_snapshot: string; precio_snapshot: string | null; cantidad: number }[];
}

export function firmarZelix(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

/** POST firmado al receptor de Zelix. Lanza si falta config o si Zelix no responde 2xx. */
export async function publishOrderPaid(payload: OrderPaidPayload): Promise<void> {
  const url = process.env.ZELIX_WEBHOOK_URL;
  const secret = process.env.ZELIXPAY_WEBHOOK_SECRET;
  if (!url || !secret) {
    throw new Error('ZELIX_WEBHOOK_URL / ZELIXPAY_WEBHOOK_SECRET no configurados');
  }
  const body = JSON.stringify(payload);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zelix-signature': firmarZelix(body, secret) },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Zelix respondió ${res.status} al publicar order.paid`);
  }
  logger.info('order.paid publicado a Zelix', { orderId: payload.order_id, externalPaymentId: payload.external_payment_id });
}
