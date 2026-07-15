import { Router } from 'express';
import type { Request, Response } from 'express';
import { paymentController } from '../controllers/payment.controller.js';
import { validate } from '../middleware/validation.middleware.js';
import {
  createOrderSchema,
  reversalWebhookSchema,
} from '../validators/payment.validators.js';
import { outboxService } from '../services/outbox.service.js';

const router = Router();

// ===========================================================
// Catálogo (solo lectura desde perfiles.pyme_context de Zelix)
// ===========================================================
router.get('/catalog/:pymeId', paymentController.getCatalog);

// ===========================================================
// Carrito -> Orden + intención de pago
// ===========================================================
router.post('/orders', validate(createOrderSchema), paymentController.createOrder);

// ===========================================================
// Provider Callback (redirect after payment page)
// ===========================================================
router.get('/payments/callback', paymentController.handleProviderCallback);
router.post('/payments/callback', paymentController.handleProviderCallback);

// ===========================================================
// Provider Webhooks (server-to-server)
// ===========================================================
router.post('/webhooks/payment-provider', paymentController.handleWebhook);
router.post('/webhooks/payment-provider/:provider', paymentController.handleProviderWebhook);
router.post('/webhooks/payment-reversal', validate(reversalWebhookSchema), paymentController.handleReversal);

// ===========================================================
// Cron (Vercel Cron Jobs)
// ===========================================================
router.get('/cron/process-outbox', async (req: Request, res: Response) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ ok: false });
    return;
  }
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
