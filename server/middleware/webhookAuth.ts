import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

/**
 * Autenticación de los webhooks que NO vienen firmados por una pasarela.
 *
 * `/api/webhooks/payment-provider` (genérico) y `/api/webhooks/payment-reversal`
 * mueven dinero por su cuenta: el primero marca un intento como pagado a partir
 * del body, el segundo revierte un pago y cancela la orden. Abiertos al mundo
 * son un bypass de pago y un botón de cancelación masiva. Requieren secreto
 * compartido; en producción, sin secreto configurado la ruta queda CERRADA
 * (fail-closed) en vez de abierta.
 */

function safeEquals(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual exige mismo largo; comparar el largo por separado no filtra
  // más de lo que ya filtra la respuesta.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function presentedSecret(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const header = req.headers['x-zelixpay-webhook-secret'];
  if (header) return String(header).trim();
  return null;
}

export function requireWebhookSecret(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.ZELIXPAY_WEBHOOK_SECRET;
  const isProduction = process.env.PAYMENT_ENVIRONMENT === 'production' || process.env.NODE_ENV === 'production';

  if (!expected) {
    if (isProduction) {
      logger.error('Webhook interno invocado sin ZELIXPAY_WEBHOOK_SECRET configurado — ruta cerrada', { path: req.path });
      res.status(503).json({
        ok: false,
        code: 'WEBHOOK_SECRET_NOT_CONFIGURED',
        message: 'Webhook deshabilitado: falta configuración del servidor.',
      });
      return;
    }
    // Fuera de producción se permite para no romper el desarrollo local, pero se
    // avisa fuerte: este mismo código en prod sin secreto no arranca (config/env.ts).
    logger.warn('Webhook interno sin ZELIXPAY_WEBHOOK_SECRET (permitido solo fuera de producción)', { path: req.path });
    next();
    return;
  }

  const presented = presentedSecret(req);
  if (!presented || !safeEquals(presented, expected)) {
    logger.warn('Webhook interno rechazado: secreto inválido o ausente', { path: req.path });
    res.status(401).json({ ok: false, code: 'UNAUTHORIZED_WEBHOOK', message: 'Unauthorized' });
    return;
  }

  next();
}

/** Mismo criterio para el cron del outbox: en producción, sin CRON_SECRET no corre. */
export function requireCronSecret(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.CRON_SECRET;
  const isProduction = process.env.PAYMENT_ENVIRONMENT === 'production' || process.env.NODE_ENV === 'production';

  if (!expected) {
    if (isProduction) {
      logger.error('Cron invocado sin CRON_SECRET configurado — ruta cerrada', { path: req.path });
      res.status(503).json({ ok: false, code: 'CRON_SECRET_NOT_CONFIGURED' });
      return;
    }
    next();
    return;
  }

  const presented = presentedSecret(req);
  if (!presented || !safeEquals(presented, expected)) {
    res.status(401).json({ ok: false, code: 'UNAUTHORIZED_CRON' });
    return;
  }

  next();
}
