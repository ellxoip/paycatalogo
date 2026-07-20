/**
 * Costura order.paid — EMISOR (§10.8 B, 2.1). Firma HMAC correcta, POST al
 * receptor, y lanza en no-2xx / sin config (para que el outbox reintente).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { firmarZelix, publishOrderPaid, type OrderPaidPayload } from '../server/workers/orderPaidHandler.js';

const SECRET = 'test-secret-zpay';
const PAYLOAD: OrderPaidPayload = {
  event: 'order.paid',
  external_payment_id: 'pay-1',
  order_id: 'ord-1',
  pyme_id: 'pyme-1',
  cliente_chat_id: null,
  canal_origen: null,
  total: 25000,
  moneda: 'CLP',
  paid_at: '2026-07-20T12:00:00Z',
  items: [{ product_id: 'p1', nombre_snapshot: 'Polerón', precio_snapshot: '25000.00', cantidad: 1 }],
};

describe('firmarZelix', () => {
  it('produce sha256=HMAC-SHA256(body) hex', () => {
    const body = JSON.stringify(PAYLOAD);
    const esperado = 'sha256=' + createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');
    expect(firmarZelix(body, SECRET)).toBe(esperado);
  });
});

describe('publishOrderPaid', () => {
  beforeEach(() => {
    process.env.ZELIX_WEBHOOK_URL = 'https://api.zelix.cl/webhook/zelixpay';
    process.env.ZELIXPAY_WEBHOOK_SECRET = SECRET;
  });
  afterEach(() => vi.restoreAllMocks());

  it('POST firmado al receptor; 2xx → resuelve', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    await publishOrderPaid(PAYLOAD);
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, opts] = spy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/webhook/zelixpay');
    const body = opts.body as string;
    expect((opts.headers as Record<string, string>)['x-zelix-signature']).toBe(firmarZelix(body, SECRET));
  });

  it('no-2xx → lanza (el outbox reintenta)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }));
    await expect(publishOrderPaid(PAYLOAD)).rejects.toThrow('500');
  });

  it('sin ZELIX_WEBHOOK_URL → lanza (no traga el error en silencio)', async () => {
    delete process.env.ZELIX_WEBHOOK_URL;
    await expect(publishOrderPaid(PAYLOAD)).rejects.toThrow('no configurados');
  });
});
