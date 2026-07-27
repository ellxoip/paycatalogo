import type { Request, Response, NextFunction } from 'express';
import { clientIp } from '../lib/clientIp.js';
import { logger } from '../lib/logger.js';

/**
 * Rate limiting sin dependencias nuevas (ventana deslizante en memoria).
 *
 * Por qué en memoria y no en Postgres/Redis: este limitador es la primera
 * barrera — tiene que responder ANTES de tocar la base, justamente para que una
 * ráfaga de carding no se convierta en una ráfaga de queries. Los límites que sí
 * necesitan memoria duradera (velocidad por comprador, rechazos acumulados)
 * viven en `fraudGuard.ts`, que sí consulta la base.
 *
 * Límite conocido: con varias instancias, cada una lleva su propio contador
 * (el techo real se multiplica por el número de instancias). Hoy ZelixPay corre
 * como un solo proceso Express detrás del proxy de zelix.cl, así que aplica tal
 * cual; si algún día se escala horizontalmente, esta es la pieza a mover a Redis
 * (la firma de `rateLimit()` no cambia).
 */

type Hit = { count: number; resetAt: number };

const buckets = new Map<string, Map<string, Hit>>();

function bucketFor(name: string) {
  let bucket = buckets.get(name);
  if (!bucket) {
    bucket = new Map();
    buckets.set(name, bucket);
  }
  return bucket;
}

/** Barrido perezoso: sin esto el Map crece con cada IP que pasó alguna vez. */
function sweep(bucket: Map<string, Hit>, now: number) {
  if (bucket.size < 5000) return;
  for (const [key, hit] of bucket) {
    if (hit.resetAt <= now) bucket.delete(key);
  }
}

export interface RateLimitOptions {
  /** Nombre del contador (aísla los límites entre sí). */
  name: string;
  windowMs: number;
  max: number;
  /** Llave del contador. Por defecto, la IP del cliente. */
  keyFn?: (req: Request) => string;
  code?: string;
  message?: string;
}

export function rateLimit(options: RateLimitOptions) {
  const { name, windowMs, max, keyFn, code = 'RATE_LIMITED', message = 'Demasiadas solicitudes. Intenta de nuevo en un momento.' } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyFn ? keyFn(req) : clientIp(req);
    const now = Date.now();
    const bucket = bucketFor(name);
    sweep(bucket, now);

    const hit = bucket.get(key);
    if (!hit || hit.resetAt <= now) {
      bucket.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    hit.count += 1;
    if (hit.count > max) {
      const retryAfter = Math.max(1, Math.ceil((hit.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      // Solo se loguea el primer exceso de cada ventana: si no, el propio ataque
      // inunda los logs (y el disco) que sirven para detectarlo.
      if (hit.count === max + 1) {
        logger.warn('Rate limit excedido', { limiter: name, key, path: req.path, max, windowMs });
      }
      res.status(429).json({ ok: false, code, message, retry_after_seconds: retryAfter });
      return;
    }

    next();
  };
}

/** Solo para tests: reinicia los contadores. */
export function __resetRateLimits() {
  buckets.clear();
}
