/**
 * Tests del blindaje: rate limiting, autenticación de webhooks internos y
 * fraudGuard (freno al card testing).
 *
 * REAL: toda la lógica de rateLimit.ts, webhookAuth.ts y fraudGuard.ts.
 * FAKE: Prisma (fake en memoria que respeta los `where` que estas consultas
 * usan: cliente_ip, created_at >= X, status in [...], OR de contacto) y los
 * objetos Request/Response de Express (mínimos, solo lo que el código toca).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = { orders: [] as Row[], attempts: [] as Row[] };

  const matchOrder = (o: Row, where: Row = {}): boolean => {
    if (where.cliente_ip !== undefined && o.cliente_ip !== where.cliente_ip) return false;
    if (where.created_at?.gte && o.created_at < where.created_at.gte) return false;
    if (where.OR) {
      const ok = where.OR.some((cond: Row) => {
        if (cond.cliente_email !== undefined) return o.cliente_email === cond.cliente_email;
        if (cond.cliente_telefono?.contains) return String(o.cliente_telefono || '').includes(cond.cliente_telefono.contains);
        return false;
      });
      if (!ok) return false;
    }
    return true;
  };

  const prismaFake = {
    order: {
      count: async ({ where }: Row) => state.orders.filter((o) => matchOrder(o, where)).length,
      findMany: async ({ where }: Row) => state.orders.filter((o) => matchOrder(o, where)),
      aggregate: async ({ where }: Row) => ({
        _sum: { total: state.orders.filter((o) => matchOrder(o, where)).reduce((acc, o) => acc + Number(o.total || 0), 0) },
      }),
    },
    paymentAttempt: {
      count: async ({ where }: Row) =>
        state.attempts.filter((a) => {
          if (where.status?.in && !where.status.in.includes(a.status)) return false;
          if (where.created_at?.gte && a.created_at < where.created_at.gte) return false;
          if (where.order?.cliente_ip !== undefined && a.cliente_ip !== where.order.cliente_ip) return false;
          return true;
        }).length,
    },
  };

  return { state, prismaFake };
});

vi.mock('../server/lib/prisma.js', () => ({ default: h.prismaFake }));

import { rateLimit, __resetRateLimits } from '../server/middleware/rateLimit.js';
import { requireWebhookSecret, requireCronSecret } from '../server/middleware/webhookAuth.js';
import { fraudGuard, FraudBlockedError } from '../server/services/fraudGuard.js';

// --- dobles mínimos de Express ---------------------------------------------
function fakeReq(overrides: Record<string, any> = {}) {
  return { ip: '1.2.3.4', path: '/api/test', headers: {}, socket: {}, ...overrides } as any;
}
function fakeRes() {
  const res: any = { statusCode: 200, body: null, headers: {} as Record<string, string> };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (payload: unknown) => { res.body = payload; return res; };
  res.setHeader = (name: string, value: string) => { res.headers[name] = value; };
  return res;
}
const run = (mw: any, req: any, res: any) => {
  let llamoNext = false;
  mw(req, res, () => { llamoNext = true; });
  return llamoNext;
};

const FRAUD_ENV = [
  'FRAUD_ORDERS_PER_IP_10MIN', 'FRAUD_ORDERS_PER_IP_HOUR', 'FRAUD_PYMES_PER_IP_HOUR',
  'FRAUD_REJECTED_PER_IP_HOUR', 'FRAUD_ORDERS_PER_CONTACT_HOUR',
  'FRAUD_MAX_ORDER_AMOUNT_CLP', 'FRAUD_MAX_AMOUNT_PER_IP_DAY_CLP',
];

beforeEach(() => {
  __resetRateLimits();
  h.state.orders.length = 0;
  h.state.attempts.length = 0;
  delete process.env.ZELIXPAY_WEBHOOK_SECRET;
  delete process.env.CRON_SECRET;
  delete process.env.PAYMENT_ENVIRONMENT;
  delete process.env.NODE_ENV;
  for (const name of FRAUD_ENV) delete process.env[name];
});

// ---------------------------------------------------------------------------
describe('rate limiting', () => {
  it('deja pasar hasta el máximo y responde 429 con Retry-After al excederlo', () => {
    const mw = rateLimit({ name: 'test-a', windowMs: 60_000, max: 3 });
    const req = fakeReq();

    for (let i = 0; i < 3; i++) expect(run(mw, req, fakeRes())).toBe(true);

    const res = fakeRes();
    expect(run(mw, req, res)).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('cuenta por IP: una IP bloqueada no afecta a otra (un comprador real no paga el ataque ajeno)', () => {
    const mw = rateLimit({ name: 'test-b', windowMs: 60_000, max: 1 });
    expect(run(mw, fakeReq({ ip: '9.9.9.9' }), fakeRes())).toBe(true);
    expect(run(mw, fakeReq({ ip: '9.9.9.9' }), fakeRes())).toBe(false);
    expect(run(mw, fakeReq({ ip: '8.8.8.8' }), fakeRes())).toBe(true);
  });

  it('IPv4 mapeada en IPv6 (::ffff:) cuenta como la misma IP', () => {
    const mw = rateLimit({ name: 'test-c', windowMs: 60_000, max: 1 });
    expect(run(mw, fakeReq({ ip: '::ffff:5.5.5.5' }), fakeRes())).toBe(true);
    expect(run(mw, fakeReq({ ip: '5.5.5.5' }), fakeRes())).toBe(false);
  });

  it('al vencer la ventana el contador se reinicia', async () => {
    const mw = rateLimit({ name: 'test-d', windowMs: 20, max: 1 });
    const req = fakeReq();
    expect(run(mw, req, fakeRes())).toBe(true);
    expect(run(mw, req, fakeRes())).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(run(mw, req, fakeRes())).toBe(true);
  });

  it('los contadores están aislados entre sí (agotar uno no cierra el otro)', () => {
    const a = rateLimit({ name: 'aislado-1', windowMs: 60_000, max: 1 });
    const b = rateLimit({ name: 'aislado-2', windowMs: 60_000, max: 1 });
    const req = fakeReq();
    expect(run(a, req, fakeRes())).toBe(true);
    expect(run(a, req, fakeRes())).toBe(false);
    expect(run(b, req, fakeRes())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('autenticación de webhooks internos', () => {
  it('en producción SIN secreto configurado la ruta queda cerrada (503), no abierta', () => {
    process.env.PAYMENT_ENVIRONMENT = 'production';
    const res = fakeRes();
    expect(run(requireWebhookSecret, fakeReq(), res)).toBe(false);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('WEBHOOK_SECRET_NOT_CONFIGURED');
  });

  it('con secreto configurado: sin credencial → 401', () => {
    process.env.ZELIXPAY_WEBHOOK_SECRET = 'x'.repeat(64);
    const res = fakeRes();
    expect(run(requireWebhookSecret, fakeReq(), res)).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('con secreto equivocado → 401; con el correcto (Bearer o header) → pasa', () => {
    const secreto = 'y'.repeat(64);
    process.env.ZELIXPAY_WEBHOOK_SECRET = secreto;

    const malo = fakeRes();
    expect(run(requireWebhookSecret, fakeReq({ headers: { authorization: 'Bearer nope' } }), malo)).toBe(false);
    expect(malo.statusCode).toBe(401);

    expect(run(requireWebhookSecret, fakeReq({ headers: { authorization: `Bearer ${secreto}` } }), fakeRes())).toBe(true);
    expect(run(requireWebhookSecret, fakeReq({ headers: { 'x-zelixpay-webhook-secret': secreto } }), fakeRes())).toBe(true);
  });

  it('fuera de producción y sin secreto, se permite (desarrollo local)', () => {
    expect(run(requireWebhookSecret, fakeReq(), fakeRes())).toBe(true);
  });

  it('el cron sigue la misma regla: producción sin CRON_SECRET → 503', () => {
    process.env.NODE_ENV = 'production';
    const res = fakeRes();
    expect(run(requireCronSecret, fakeReq(), res)).toBe(false);
    expect(res.statusCode).toBe(503);
  });
});

// ---------------------------------------------------------------------------
describe('fraudGuard — freno al card testing', () => {
  const IP = '200.100.50.25';
  const ahora = () => new Date();
  const haceMinutos = (m: number) => new Date(Date.now() - m * 60_000);

  const orden = (extra: Record<string, any> = {}) => ({
    cliente_ip: IP, pyme_id: 'pyme-1', total: 10_000, created_at: ahora(), ...extra,
  });
  const contexto = (extra: Record<string, any> = {}) => ({
    ip: IP, pymeId: 'pyme-1', amount: 10_000, ...extra,
  });

  const codigo = async (p: Promise<unknown>) =>
    p.then(() => null, (e) => (e instanceof FraudBlockedError ? e.code : `INESPERADO:${e.message}`));

  it('un pedido normal pasa', async () => {
    await expect(fraudGuard.assertOrderAllowed(contexto())).resolves.toBeUndefined();
  });

  it('ráfaga: 5 órdenes en 10 minutos desde la misma IP → bloqueo', async () => {
    for (let i = 0; i < 5; i++) h.state.orders.push(orden({ created_at: haceMinutos(2) }));
    expect(await codigo(fraudGuard.assertOrderAllowed(contexto()))).toBe('IP_BURST');
  });

  it('las órdenes viejas no cuentan: 5 de hace 30 minutos no gatillan la ventana de 10 min', async () => {
    for (let i = 0; i < 5; i++) h.state.orders.push(orden({ created_at: haceMinutos(30) }));
    await expect(fraudGuard.assertOrderAllowed(contexto())).resolves.toBeUndefined();
  });

  it('volumen horario: 12 órdenes en 1 h → bloqueo', async () => {
    process.env.FRAUD_ORDERS_PER_IP_10MIN = '0'; // aísla el límite horario
    for (let i = 0; i < 12; i++) h.state.orders.push(orden({ created_at: haceMinutos(45) }));
    expect(await codigo(fraudGuard.assertOrderAllowed(contexto()))).toBe('IP_HOURLY_VOLUME');
  });

  it('barrido de comercios: la misma IP tocando 4 PYMEs distintas en 1 h → bloqueo', async () => {
    process.env.FRAUD_ORDERS_PER_IP_10MIN = '0';
    ['pyme-a', 'pyme-b', 'pyme-c'].forEach((pyme_id) =>
      h.state.orders.push(orden({ pyme_id, created_at: haceMinutos(20) })));
    expect(await codigo(fraudGuard.assertOrderAllowed(contexto({ pymeId: 'pyme-d' })))).toBe('IP_MERCHANT_SWEEP');
  });

  it('racha de rechazos: 3 intentos caídos en 1 h desde la misma IP → bloqueo (la firma del carding)', async () => {
    for (let i = 0; i < 3; i++) {
      h.state.attempts.push({ status: 'rechazado', created_at: haceMinutos(5), cliente_ip: IP });
    }
    expect(await codigo(fraudGuard.assertOrderAllowed(contexto()))).toBe('IP_REJECTED_STREAK');
  });

  it('los rechazos de OTRA IP no bloquean al comprador legítimo', async () => {
    for (let i = 0; i < 10; i++) {
      h.state.attempts.push({ status: 'rechazado', created_at: haceMinutos(5), cliente_ip: '10.0.0.1' });
    }
    await expect(fraudGuard.assertOrderAllowed(contexto())).resolves.toBeUndefined();
  });

  it('monto por sobre el tope de una orden → bloqueo', async () => {
    expect(await codigo(fraudGuard.assertOrderAllowed(contexto({ amount: 5_000_000 })))).toBe('ORDER_AMOUNT_TOO_HIGH');
  });

  it('acumulado diario por IP sobre el tope → bloqueo', async () => {
    process.env.FRAUD_ORDERS_PER_IP_10MIN = '0';
    process.env.FRAUD_ORDERS_PER_IP_HOUR = '0';
    h.state.orders.push(orden({ total: 2_900_000, created_at: haceMinutos(600) }));
    expect(await codigo(fraudGuard.assertOrderAllowed(contexto({ amount: 200_000 })))).toBe('IP_DAILY_AMOUNT');
  });

  it('velocidad por contacto: mismo correo en 6 órdenes dentro de 1 h → bloqueo aunque cambie la IP', async () => {
    for (let i = 0; i < 6; i++) {
      h.state.orders.push(orden({ cliente_ip: `5.5.5.${i}`, cliente_email: 'bot@carding.test', created_at: haceMinutos(10) }));
    }
    expect(await codigo(fraudGuard.assertOrderAllowed(contexto({ ip: '7.7.7.7', email: 'bot@carding.test' }))))
      .toBe('CONTACT_VELOCITY');
  });

  it('el mensaje al cliente no revela qué umbral se tocó (el detalle solo va al log)', async () => {
    for (let i = 0; i < 5; i++) h.state.orders.push(orden({ created_at: haceMinutos(2) }));
    const error = await fraudGuard.assertOrderAllowed(contexto()).catch((e) => e as FraudBlockedError);
    expect(error).toBeInstanceOf(FraudBlockedError);
    expect((error as FraudBlockedError).message).not.toMatch(/IP|órdenes|límite|10 min/i);
    expect((error as FraudBlockedError).reason).toMatch(/órdenes en 10 min/);
    expect((error as FraudBlockedError).status).toBe(429);
  });

  it('sin IP identificable no se bloquea por origen, pero sí por contacto', async () => {
    for (let i = 0; i < 5; i++) h.state.orders.push(orden({ created_at: haceMinutos(2) }));
    await expect(fraudGuard.assertOrderAllowed(contexto({ ip: 'unknown' }))).resolves.toBeUndefined();
  });

  it('un límite en 0 queda desactivado (válvula de emergencia por variable de entorno)', async () => {
    process.env.FRAUD_ORDERS_PER_IP_10MIN = '0';
    process.env.FRAUD_ORDERS_PER_IP_HOUR = '0';
    for (let i = 0; i < 30; i++) h.state.orders.push(orden({ created_at: haceMinutos(1) }));
    await expect(fraudGuard.assertOrderAllowed(contexto())).resolves.toBeUndefined();
  });
});
