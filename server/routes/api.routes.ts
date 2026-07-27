import { Router } from 'express';
import type { Request, Response } from 'express';
import { paymentController } from '../controllers/payment.controller.js';
import { validate } from '../middleware/validation.middleware.js';
import {
  createOrderSchema,
  reversalWebhookSchema,
} from '../validators/payment.validators.js';
import { outboxService } from '../services/outbox.service.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireWebhookSecret, requireCronSecret } from '../middleware/webhookAuth.js';

const router = Router();

// ===========================================================
// Catálogo (solo lectura desde perfiles.pyme_context de Zelix)
// ===========================================================
// Generoso: navegar el catálogo es gratis y legítimo. El límite existe solo
// para que nadie use el endpoint como raspador del catálogo de las PYMEs.
router.get(
  '/catalog/:pymeId',
  rateLimit({ name: 'catalog', windowMs: 60_000, max: 60 }),
  paymentController.getCatalog,
);

// ===========================================================
// Carrito -> Orden + intención de pago
// ===========================================================
// La puerta que el carding golpea. Dos ventanas: una corta contra la ráfaga,
// una larga contra el goteo lento que la esquivaría.
router.post(
  '/orders',
  rateLimit({ name: 'orders-burst', windowMs: 60_000, max: 4, message: 'Demasiados intentos de compra seguidos. Espera un minuto.' }),
  rateLimit({ name: 'orders-hour', windowMs: 60 * 60_000, max: 20, message: 'Demasiados pedidos desde esta conexión. Intenta más tarde.' }),
  validate(createOrderSchema),
  paymentController.createOrder,
);

// ===========================================================
// Provider Callback (redirect after payment page)
// ===========================================================
// Lo abre el navegador del comprador al volver de Flow. No mueve plata por sí
// solo (re-consulta a Flow), pero sí gatilla llamadas salientes: se limita para
// que no se use como amplificador contra la API de Flow.
const callbackLimiter = rateLimit({ name: 'callback', windowMs: 60_000, max: 20 });
router.get('/payments/callback', callbackLimiter, paymentController.handleProviderCallback);
router.post('/payments/callback', callbackLimiter, paymentController.handleProviderCallback);

// ===========================================================
// Provider Webhooks (server-to-server)
// ===========================================================
// Webhook interno SIN firma de pasarela: marca un intento como pagado a partir
// del body. Exige secreto compartido — abierto es un bypass de pago.
router.post(
  '/webhooks/payment-provider',
  requireWebhookSecret,
  rateLimit({ name: 'webhook-interno', windowMs: 60_000, max: 30 }),
  paymentController.handleWebhook,
);
// Webhook de la pasarela (Flow): no trae firma, pero el servidor re-consulta el
// estado contra Flow antes de aprobar, así que el body no se cree por sí mismo.
router.post(
  '/webhooks/payment-provider/:provider',
  rateLimit({ name: 'webhook-pasarela', windowMs: 60_000, max: 60 }),
  paymentController.handleProviderWebhook,
);
// Reversas: cancelan pagos y órdenes. Solo con secreto.
router.post(
  '/webhooks/payment-reversal',
  requireWebhookSecret,
  rateLimit({ name: 'webhook-reversa', windowMs: 60_000, max: 20 }),
  validate(reversalWebhookSchema),
  paymentController.handleReversal,
);

// ===========================================================
// Cron (Vercel Cron Jobs)
// ===========================================================
router.get('/cron/process-outbox', requireCronSecret, async (_req: Request, res: Response) => {
  try {
    const result = await outboxService.processOnce();
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===========================================================
// Health & Status
// ===========================================================
router.get('/health', paymentController.healthCheck);

export default router;
