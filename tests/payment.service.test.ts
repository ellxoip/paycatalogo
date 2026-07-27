/**
 * Tests reales de PaymentService (sub-fase 1 del frente "costura order.paid").
 *
 * Qué es real y qué es fake — declarado sin maquillaje:
 *  - REAL: toda la lógica de payment.service.ts (validaciones, parseo de precio,
 *    snapshots, totales, máquina de estados creada→pagada / iniciado→confirmado/
 *    rechazado, idempotencia incl. la rama P2002), la regla productoDisponible
 *    (importada del módulo original) y el SimulatorProvider REAL (delay 0) con su
 *    regla determinista de outcome (monto terminado en 99/88/77 → rechazo).
 *  - FAKE: el ALMACENAMIENTO (Prisma → fake en memoria con estado que respeta los
 *    where/include usados) y la LECTURA del catálogo de Zelix (getCatalog
 *    controlado por test — es una fuente de datos externa, no lógica del SUT).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Fake de Prisma con estado (hoisted: vi.mock lo necesita antes de los imports)
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = {
    orders: [] as Row[],
    attempts: [] as Row[],
    payments: [] as Row[],
    raceOnce: false, // simula la carrera read-before-write que dispara P2002
    seq: 0,
  };
  const id = (p: string) => `${p}_${++state.seq}`;

  const prismaFake = {
    order: {
      create: async ({ data, include }: Row) => {
        const items = (data.items?.create ?? []).map((it: Row) => ({ id: id('item'), ...it }));
        const row = { id: id('order'), ...data, items };
        delete row.items_create;
        state.orders.push(row);
        return include?.items ? row : { ...row, items: undefined };
      },
      update: async ({ where, data }: Row) => {
        const row = state.orders.find((o) => o.id === where.id);
        if (!row) throw new Error(`order ${where.id} not found`);
        Object.assign(row, data);
        return row;
      },
    },
    paymentAttempt: {
      create: async ({ data }: Row) => {
        const row = { id: id('att'), ...data };
        state.attempts.push(row);
        return row;
      },
      findFirst: async ({ where }: Row) =>
        state.attempts.find((a) => a.provider_transaction_id === where.provider_transaction_id) ?? null,
      findUnique: async ({ where }: Row) =>
        state.attempts.find((a) => a.external_attempt_id === where.external_attempt_id) ?? null,
      update: async ({ where, data }: Row) => {
        const row = state.attempts.find((a) => a.id === where.id);
        if (!row) throw new Error(`attempt ${where.id} not found`);
        Object.assign(row, data);
        return row;
      },
    },
    payment: {
      findFirst: async ({ where }: Row) => {
        const found = state.payments.find((p) => p.payment_attempt_id === where.payment_attempt_id) ?? null;
        if (found && state.raceOnce) {
          state.raceOnce = false; // el "otro proceso" aún no era visible en la lectura
          return null;
        }
        return found;
      },
      create: async ({ data }: Row) => {
        // UNIQUE real del schema: un Payment por payment_attempt_id
        if (state.payments.some((p) => p.payment_attempt_id === data.payment_attempt_id)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        const row = { id: id('pay'), ...data };
        state.payments.push(row);
        return row;
      },
    },
  };

  const getCatalogMock = vi.fn();
  return { state, prismaFake, getCatalogMock };
});

vi.mock('../server/lib/prisma.js', () => ({ default: h.prismaFake }));

vi.mock('../server/services/catalog.service.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../server/services/catalog.service.js')>();
  return { ...orig, catalogService: { getCatalog: h.getCatalogMock } };
});

vi.mock('../server/providers/index.js', async () => {
  const { SimulatorProvider } = await import('../server/providers/simulator.provider.js');
  const sim = new SimulatorProvider({ delayMs: 0 }); // provider REAL, sin espera artificial
  return { providerRegistry: { get: () => sim, getDefault: () => sim }, isSimulatorDemoEnabled: () => true };
});

import { paymentService } from '../server/services/payment.service.js';

// ---------------------------------------------------------------------------
// Catálogo de prueba (contrato pyme_context real: precio texto libre, stock/activo v1.4)
// ---------------------------------------------------------------------------
const PYME = 'pyme-test-1';
const CATALOGO = {
  pyme_id: PYME,
  pyme_nombre: 'Carnes Test',
  moneda: 'CLP',
  productos: [
    { id: 'panceta', nombre: 'Panceta parrillera', precio: '$12.990', stock: 5 },
    { id: 'cheesecake', nombre: 'Cheesecake', precio: '2.249', stock: 2 },
    { id: 'pausado', nombre: 'Producto pausado', precio: '$1.000', activo: false },
    { id: 'agotado', nombre: 'Producto agotado', precio: '$1.000', stock: 0 },
    { id: 'sinprecio', nombre: 'Sin precio', precio: null },
    { id: 'precioilegible', nombre: 'Precio a convenir', precio: 'a convenir' },
    // 12.990*1 + 2.249*? — para forzar rechazo determinista: total terminado en 99
    { id: 'rechazable', nombre: 'Forzador de rechazo', precio: '$1.099' }, // 1099 % 100 = 99
  ],
};

function reset() {
  h.state.orders.length = 0;
  h.state.attempts.length = 0;
  h.state.payments.length = 0;
  h.state.raceOnce = false;
  h.getCatalogMock.mockReset();
  h.getCatalogMock.mockResolvedValue(structuredClone(CATALOGO));
  delete process.env.PAYMENT_DEFAULT_PROVIDER; // → resolveProviderName cae a 'simulator'
}
beforeEach(reset);

const crear = (items: Array<{ product_id: string; cantidad?: number }>, extra: Record<string, unknown> = {}) =>
  paymentService.createOrderWithPaymentIntent({ pyme_id: PYME, items, ...extra } as never);

const codeOf = (p: Promise<unknown>) => p.then(() => null, (e) => e.code ?? null);

// ---------------------------------------------------------------------------
describe('creación de orden — bordes', () => {
  it('sin pyme_id → MISSING_PYME_ID; carrito vacío → EMPTY_CART', async () => {
    await expect(codeOf(paymentService.createOrderWithPaymentIntent({ items: [{ product_id: 'x' }] } as never))).resolves.toBe('MISSING_PYME_ID');
    await expect(codeOf(crear([]))).resolves.toBe('EMPTY_CART');
    expect(h.state.orders).toHaveLength(0); // nada se persiste en un rechazo de validación
  });

  it('pyme sin catálogo vigente → CATALOG_NOT_FOUND', async () => {
    h.getCatalogMock.mockResolvedValue(null);
    await expect(codeOf(crear([{ product_id: 'panceta' }]))).resolves.toBe('CATALOG_NOT_FOUND');
  });

  it('producto inexistente → PRODUCT_NOT_FOUND; pausado/agotado → PRODUCT_UNAVAILABLE (distingue los casos)', async () => {
    await expect(codeOf(crear([{ product_id: 'no-existe' }]))).resolves.toBe('PRODUCT_NOT_FOUND');
    await expect(codeOf(crear([{ product_id: 'pausado' }]))).resolves.toBe('PRODUCT_UNAVAILABLE');
    await expect(codeOf(crear([{ product_id: 'agotado' }]))).resolves.toBe('PRODUCT_UNAVAILABLE');
  });

  it('cantidad mayor al stock → INSUFFICIENT_STOCK (stock 2, pido 3)', async () => {
    await expect(codeOf(crear([{ product_id: 'cheesecake', cantidad: 3 }]))).resolves.toBe('INSUFFICIENT_STOCK');
  });

  it('precio null o sin dígitos → PRODUCT_WITHOUT_PRICE (el carrito no inventa precios)', async () => {
    await expect(codeOf(crear([{ product_id: 'sinprecio' }]))).resolves.toBe('PRODUCT_WITHOUT_PRICE');
    await expect(codeOf(crear([{ product_id: 'precioilegible' }]))).resolves.toBe('PRODUCT_WITHOUT_PRICE');
  });

  it('camino feliz: snapshots, parseo de precio CLP, cantidades saneadas y total correcto', async () => {
    const r = await crear([
      { product_id: 'panceta', cantidad: 2.7 },  // se sanea a floor → 2
      { product_id: 'cheesecake', cantidad: 0 }, // se sanea a mínimo → 1
    ]);
    expect(r.total).toBe(12990 * 2 + 2249);
    expect(r.moneda).toBe('CLP');
    expect(r.provider).toBe('simulator');
    expect(r.payment_url).toContain('token=');

    const order = h.state.orders[0];
    expect(order.status).toBe('creada');
    expect(order.items.map((i: { product_id: string; precio_snapshot: number; cantidad: number }) => [i.product_id, i.precio_snapshot, i.cantidad]))
      .toEqual([['panceta', 12990, 2], ['cheesecake', 2249, 1]]);

    const att = h.state.attempts[0];
    expect(att.status).toBe('iniciado');
    expect(att.order_id).toBe(order.id);
    expect(Number(att.amount)).toBe(r.total);
  });
});

// ---------------------------------------------------------------------------
describe('confirmación de pago (callback del proveedor, simulador REAL)', () => {
  it('pago APROBADO: attempt→confirmado, Payment confirmado creado, Order→pagada', async () => {
    const r = await crear([{ product_id: 'panceta' }]); // 12990 → aprueba (no termina en 77/88/99)
    const token = h.state.attempts[0].provider_transaction_id;

    const payment = await paymentService.processProviderCallback(token);

    expect(h.state.attempts[0].status).toBe('confirmado');
    expect(h.state.payments).toHaveLength(1);
    expect((payment as { status: string }).status).toBe('confirmado');
    expect(h.state.orders[0].status).toBe('pagada');
    expect(Number(h.state.payments[0].amount)).toBe(r.total);
  });

  it('pago RECHAZADO (total termina en 99): attempt→rechazado, SIN Payment, Order sigue creada', async () => {
    await crear([{ product_id: 'rechazable' }]); // 1099 → regla amount_ends_99 del simulador
    const token = h.state.attempts[0].provider_transaction_id;

    const r = await paymentService.processProviderCallback(token);

    expect(r).toMatchObject({ status: 'rejected' });
    expect(h.state.attempts[0].status).toBe('rechazado');
    expect(h.state.payments).toHaveLength(0);
    expect(h.state.orders[0].status).toBe('creada'); // el rechazo JAMÁS marca pagada
  });

  it('token desconocido → TRANSACTION_NOT_FOUND', async () => {
    await expect(codeOf(paymentService.processProviderCallback('sim_txn_inexistente_a5000'))).resolves.toBe('TRANSACTION_NOT_FOUND');
  });

  it('idempotencia del webhook: dos avisos "approved" del proveedor → UN solo Payment', async () => {
    await crear([{ product_id: 'panceta' }]);
    const att = h.state.attempts[0];
    const aviso = {
      external_attempt_id: att.external_attempt_id,
      provider_transaction_id: att.provider_transaction_id,
      status: 'approved' as const,
      amount: Number(att.amount),
    };

    const p1 = await paymentService.processWebhook(aviso);
    const p2 = await paymentService.processWebhook(aviso); // reintento del proveedor

    expect(h.state.payments).toHaveLength(1);
    expect((p2 as { external_payment_id: string }).external_payment_id)
      .toBe((p1 as { external_payment_id: string }).external_payment_id);
    expect(h.state.orders[0].status).toBe('pagada');
  });

  it('carrera read-before-write (rama P2002): el UNIQUE de la BD frena el duplicado y se devuelve el Payment existente', async () => {
    await crear([{ product_id: 'panceta' }]);
    const att = h.state.attempts[0];
    const aviso = {
      external_attempt_id: att.external_attempt_id,
      provider_transaction_id: att.provider_transaction_id,
      status: 'approved' as const,
      amount: Number(att.amount),
    };
    const p1 = await paymentService.processWebhook(aviso);

    // Simula que la lectura previa aún no ve el Payment (dos webhooks casi simultáneos):
    h.state.raceOnce = true;
    const p2 = await paymentService.processWebhook(aviso);

    expect(h.state.payments).toHaveLength(1); // el UNIQUE (P2002) impidió el doble cobro registrado
    expect((p2 as { id: string }).id).toBe((p1 as { id: string }).id);
  });

  it('webhook de un attempt inexistente → ATTEMPT_NOT_FOUND', async () => {
    await expect(codeOf(paymentService.processWebhook({
      external_attempt_id: 'zpay_attempt_fantasma', status: 'approved', amount: 1000,
    } as never))).resolves.toBe('ATTEMPT_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// Blindaje: el monto de la orden manda, y el proveedor no lo elige el cliente
// ---------------------------------------------------------------------------
describe('blindaje de pagos', () => {
  it('webhook "approved" con monto distinto al de la orden → AMOUNT_MISMATCH, sin Payment ni Order pagada', async () => {
    await crear([{ product_id: 'panceta' }]); // 12990
    const att = h.state.attempts[0];

    const code = await codeOf(paymentService.processWebhook({
      external_attempt_id: att.external_attempt_id,
      provider_transaction_id: att.provider_transaction_id,
      status: 'approved',
      amount: 100, // el atacante declara pagar 100 por una orden de 12.990
    } as never));

    expect(code).toBe('AMOUNT_MISMATCH');
    expect(h.state.payments).toHaveLength(0);
    expect(h.state.orders[0].status).toBe('creada');
  });

  it('el monto declarado se ignora: el Payment se registra con el monto de la orden', async () => {
    const r = await crear([{ product_id: 'panceta' }]);
    const att = h.state.attempts[0];

    await paymentService.processWebhook({
      external_attempt_id: att.external_attempt_id,
      provider_transaction_id: att.provider_transaction_id,
      status: 'approved',
      amount: Number(att.amount),
    } as never);

    expect(Number(h.state.payments[0].amount)).toBe(r.total);
  });

  it('en producción el provider del body se ignora (no se puede pedir "simulator" para pagar gratis)', async () => {
    const previo = process.env.PAYMENT_ENVIRONMENT;
    process.env.PAYMENT_ENVIRONMENT = 'production';
    try {
      // El registry mockeado devuelve siempre el simulador; lo que se comprueba
      // es que resolveProviderName consulta al registry (getDefault) y NO al body.
      const r = await crear([{ product_id: 'panceta' }], { provider: 'simulator' });
      expect(r.provider).toBe('simulator'); // el del servidor, no el pedido
    } finally {
      if (previo === undefined) delete process.env.PAYMENT_ENVIRONMENT;
      else process.env.PAYMENT_ENVIRONMENT = previo;
    }
  });
});
