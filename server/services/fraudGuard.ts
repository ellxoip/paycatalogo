import prisma from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

/**
 * fraudGuard — freno al *card testing* (carding).
 *
 * El ataque que este archivo existe para detener: un bot toma una lista de
 * tarjetas robadas y las prueba de a cientos contra un checkout abierto. Cada
 * intento es una transacción real en Flow. El daño no es el pago (casi todos se
 * rechazan): es la avalancha de rechazos y contracargos contra la cuenta de
 * comercio, que termina en multas del adquirente o en el cierre de la cuenta.
 *
 * Señales que delatan carding, y que aquí se miden:
 *   1. Volumen: muchas órdenes desde una misma IP en poco rato.
 *   2. Barrido: una misma IP tocando varios comercios distintos (un comprador
 *      real compra en una PYME, no en cinco en la misma hora).
 *   3. Rechazos: proporción alta de intentos rechazados desde el mismo origen
 *      — la firma más nítida del card testing.
 *   4. Montos: órdenes de monto absurdo, o acumulado diario desproporcionado.
 *
 * El rate limit de `middleware/rateLimit.ts` corta las ráfagas brutas antes de
 * llegar a la base; esto corta lo que pasa el filtro y es persistente (sobrevive
 * a reinicios y no depende de la memoria del proceso).
 */

function envInt(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export interface FraudGuardLimits {
  ordersPerIp10Min: number;
  ordersPerIpPerHour: number;
  pymesPerIpPerHour: number;
  rejectedPerIpPerHour: number;
  ordersPerContactPerHour: number;
  maxOrderAmount: number;
  maxAmountPerIpPerDay: number;
}

export function currentLimits(): FraudGuardLimits {
  return {
    ordersPerIp10Min: envInt('FRAUD_ORDERS_PER_IP_10MIN', 5),
    ordersPerIpPerHour: envInt('FRAUD_ORDERS_PER_IP_HOUR', 12),
    pymesPerIpPerHour: envInt('FRAUD_PYMES_PER_IP_HOUR', 3),
    rejectedPerIpPerHour: envInt('FRAUD_REJECTED_PER_IP_HOUR', 3),
    ordersPerContactPerHour: envInt('FRAUD_ORDERS_PER_CONTACT_HOUR', 6),
    maxOrderAmount: envInt('FRAUD_MAX_ORDER_AMOUNT_CLP', 2_000_000),
    maxAmountPerIpPerDay: envInt('FRAUD_MAX_AMOUNT_PER_IP_DAY_CLP', 3_000_000),
  };
}

export interface OrderRiskContext {
  ip: string;
  pymeId: string;
  amount: number;
  email?: string | null;
  telefono?: string | null;
}

export class FraudBlockedError extends Error {
  readonly status = 429;
  readonly code: string;
  readonly reason: string;

  constructor(reason: string, code = 'FRAUD_GUARD_BLOCKED') {
    // Mensaje deliberadamente vago hacia afuera: decirle al atacante cuál
    // umbral tocó es regalarle el mapa para esquivarlo. El detalle va al log.
    super('No pudimos procesar este pedido en este momento. Intenta más tarde o escríbele al comercio.');
    this.code = code;
    this.reason = reason;
  }
}

const HOUR_MS = 60 * 60 * 1000;

class FraudGuard {
  /**
   * Se llama ANTES de crear la orden y de tocar Flow. Lanza FraudBlockedError si
   * el origen huele a card testing.
   */
  async assertOrderAllowed(context: OrderRiskContext): Promise<void> {
    const limits = currentLimits();

    if (limits.maxOrderAmount > 0 && context.amount > limits.maxOrderAmount) {
      this.block(context, `monto de la orden ${context.amount} sobre el tope ${limits.maxOrderAmount}`, 'ORDER_AMOUNT_TOO_HIGH');
    }

    // Sin IP identificable no hay velocidad que medir; se deja pasar (un proxy
    // mal configurado no debe bloquear ventas reales) pero queda registrado.
    if (!context.ip || context.ip === 'unknown') {
      logger.warn('fraudGuard sin IP identificable — no se aplican límites por origen', { pymeId: context.pymeId });
      await this.assertContactVelocity(context, limits);
      return;
    }

    const now = Date.now();
    const since10Min = new Date(now - 10 * 60 * 1000);
    const sinceHour = new Date(now - HOUR_MS);
    const sinceDay = new Date(now - 24 * HOUR_MS);

    const [orders10Min, ordersHour, recentOrders, rejectedHour, spentDay] = await Promise.all([
      prisma.order.count({ where: { cliente_ip: context.ip, created_at: { gte: since10Min } } }),
      prisma.order.count({ where: { cliente_ip: context.ip, created_at: { gte: sinceHour } } }),
      prisma.order.findMany({
        where: { cliente_ip: context.ip, created_at: { gte: sinceHour } },
        select: { pyme_id: true },
      }),
      prisma.paymentAttempt.count({
        where: {
          status: { in: ['rechazado', 'error'] },
          created_at: { gte: sinceHour },
          order: { cliente_ip: context.ip },
        },
      }),
      prisma.order.aggregate({
        _sum: { total: true },
        where: { cliente_ip: context.ip, created_at: { gte: sinceDay } },
      }),
    ]);

    if (limits.ordersPerIp10Min > 0 && orders10Min >= limits.ordersPerIp10Min) {
      this.block(context, `${orders10Min} órdenes en 10 min desde la misma IP`, 'IP_BURST');
    }

    if (limits.ordersPerIpPerHour > 0 && ordersHour >= limits.ordersPerIpPerHour) {
      this.block(context, `${ordersHour} órdenes en 1 h desde la misma IP`, 'IP_HOURLY_VOLUME');
    }

    const pymesTocadas = new Set(recentOrders.map((o) => o.pyme_id));
    pymesTocadas.add(context.pymeId);
    if (limits.pymesPerIpPerHour > 0 && pymesTocadas.size > limits.pymesPerIpPerHour) {
      this.block(context, `misma IP tocando ${pymesTocadas.size} comercios distintos en 1 h`, 'IP_MERCHANT_SWEEP');
    }

    // La señal más fuerte: pagos que se caen uno tras otro desde el mismo origen.
    if (limits.rejectedPerIpPerHour > 0 && rejectedHour >= limits.rejectedPerIpPerHour) {
      this.block(context, `${rejectedHour} intentos rechazados en 1 h desde la misma IP (card testing)`, 'IP_REJECTED_STREAK');
    }

    const gastadoDia = Number(spentDay._sum.total || 0);
    if (limits.maxAmountPerIpPerDay > 0 && gastadoDia + context.amount > limits.maxAmountPerIpPerDay) {
      this.block(context, `acumulado diario ${gastadoDia + context.amount} sobre el tope ${limits.maxAmountPerIpPerDay}`, 'IP_DAILY_AMOUNT');
    }

    await this.assertContactVelocity(context, limits);
  }

  /**
   * Velocidad por comprador. Cambiar de IP es barato (VPN, botnet); mantener el
   * mismo correo o teléfono a lo largo del ataque es común cuando el bot rellena
   * el formulario con datos fijos.
   */
  private async assertContactVelocity(context: OrderRiskContext, limits: FraudGuardLimits) {
    if (limits.ordersPerContactPerHour <= 0) return;

    const email = context.email?.trim().toLowerCase();
    const telefono = context.telefono?.replace(/[^\d+]/g, '');
    const contactFilters: Array<Record<string, unknown>> = [];
    if (email) contactFilters.push({ cliente_email: email });
    if (telefono && telefono.length >= 8) contactFilters.push({ cliente_telefono: { contains: telefono.slice(-8) } });
    if (contactFilters.length === 0) return;

    const sinceHour = new Date(Date.now() - HOUR_MS);
    const count = await prisma.order.count({
      where: { created_at: { gte: sinceHour }, OR: contactFilters },
    });

    if (count >= limits.ordersPerContactPerHour) {
      this.block(context, `${count} órdenes en 1 h con el mismo contacto`, 'CONTACT_VELOCITY');
    }
  }

  private block(context: OrderRiskContext, reason: string, code: string): never {
    logger.warn('fraudGuard bloqueó un pedido', {
      code,
      reason,
      ip: context.ip,
      pymeId: context.pymeId,
      amount: context.amount,
    });
    throw new FraudBlockedError(reason, code);
  }
}

export const fraudGuard = new FraudGuard();
