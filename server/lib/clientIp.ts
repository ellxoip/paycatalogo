import type { Request } from 'express';

/**
 * IP real del cliente. ZelixPay corre detrás del proxy de www.zelix.cl, así que
 * `req.ip` sin `trust proxy` devolvería siempre la IP del proxy — y entonces
 * TODO el tráfico compartiría una sola llave de rate limit (o el atacante
 * quedaría anónimo). `app.ts` fija `trust proxy`, aquí solo normalizamos.
 *
 * Nunca se confía en X-Forwarded-For crudo: Express ya lo resolvió según la
 * cadena de proxies declarada; el fallback es solo para tests/uso directo.
 */
export function clientIp(req: Request): string {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  // ::ffff:1.2.3.4 → 1.2.3.4 (IPv4 mapeada en IPv6): la misma IP no debe contar
  // como dos llaves distintas de rate limit.
  return ip.replace(/^::ffff:/, '');
}

export function clientUserAgent(req: Request): string | null {
  const ua = req.headers['user-agent'];
  if (!ua) return null;
  return String(ua).slice(0, 300);
}
