import { Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { paymentService } from '../services/payment.service.js';
import { catalogService } from '../services/catalog.service.js';
import { providerRegistry } from '../providers/index.js';
import { logger } from '../lib/logger.js';
import { clientIp, clientUserAgent } from '../lib/clientIp.js';

export class PaymentController {

  // ===========================================================
  // GET /api/catalog/:pymeId
  // ===========================================================
  async getCatalog(req: Request, res: Response) {
    try {
      const catalog = await catalogService.getCatalog(req.params.pymeId);
      if (!catalog) {
        res.status(404).json({ ok: false, code: 'CATALOG_NOT_FOUND', message: 'PYME o catálogo no encontrado' });
        return;
      }
      res.json({ ok: true, ...catalog });
    } catch (error: any) {
      res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: error.message });
    }
  }

  // ===========================================================
  // POST /api/orders — carrito -> Order + intención de pago
  // ===========================================================
  async createOrder(req: Request, res: Response) {
    try {
      const result = await paymentService.createOrderWithPaymentIntent(req.body, {
        ip: clientIp(req),
        userAgent: clientUserAgent(req),
      });
      res.status(201).json({ ok: true, ...result });
    } catch (error: any) {
      res.status(error.status || 400).json({
        ok: false, code: error.code || 'ORDER_ERROR', message: error.message,
      });
    }
  }

  // ===========================================================
  // GET/POST /api/payments/callback — Provider redirect
  // ===========================================================
  async handleProviderCallback(req: Request, res: Response) {
    const clientBase = (process.env.CLIENT_PORTAL_BASE_URL || 'http://localhost:3003/catalogo/pay').replace(/\/+$/, '');
    try {
      const token = (req.query.token || req.query.token_ws || req.body?.token || req.body?.token_ws) as string;
      const providerName = (req.query.provider || req.body?.provider) as string | undefined;

      if (!token) {
        res.status(400).json({ ok: false, code: 'MISSING_TOKEN', message: 'No payment token received' });
        return;
      }

      const result = await paymentService.processProviderCallback(token, providerName);
      const status = (result as any)?.status === 'confirmado' ? 'success' : 'failed';
      const query = new URLSearchParams({ result: status, payment_id: (result as any)?.external_payment_id || '' });
      if (providerName) query.set('provider', providerName);
      res.redirect(`${clientBase}/checkout?${query.toString()}`);
    } catch (error: any) {
      res.redirect(`${clientBase}/checkout?result=error&message=${encodeURIComponent(error.message)}`);
    }
  }

  // ===========================================================
  // Webhooks (server-to-server)
  // ===========================================================
  async handleWebhook(req: Request, res: Response) {
    try {
      const result = await paymentService.processWebhook(req.body);
      res.json({ ok: true, result });
    } catch (error: any) {
      logger.error('Payment webhook error', { error: error as Error });
      res.status(error.status || 500).json({ ok: false, code: error.code || 'WEBHOOK_ERROR', message: error.message });
    }
  }

  async handleProviderWebhook(req: Request, res: Response) {
    try {
      const { provider } = req.params;
      const result = await paymentService.processProviderWebhook(
        provider,
        req.headers as Record<string, string>,
        req.body,
        req.query,
      );
      res.json({ ok: true, result });
    } catch (error: any) {
      logger.error('Payment provider webhook error', { error: error as Error });
      res.status(error.status || 500).json({ ok: false, code: error.code || 'WEBHOOK_ERROR', message: error.message });
    }
  }

  async handleReversal(req: Request, res: Response) {
    try {
      const result = await paymentService.processReversal(req.body);
      res.json({ ok: true, result });
    } catch (error: any) {
      res.status(error.status || 500).json({ ok: false, code: error.code || 'REVERSAL_ERROR', message: error.message });
    }
  }

  // ===========================================================
  // GET /api/health
  // ===========================================================
  async healthCheck(_req: Request, res: Response) {
    let databaseStatus = 'connected';
    let databaseError: string | null = null;

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error: any) {
      databaseStatus = 'degraded';
      databaseError = error.message;
    }

    const providerHealth = await providerRegistry.healthCheckAll();
    const status = databaseStatus === 'connected' ? 'healthy' : 'degraded';

    // /api/health es público (lo consulta el proxy y el monitoreo). El detalle
    // del error de base y el mensaje de cada proveedor pueden filtrar cadenas de
    // conexión o fragmentos de credenciales: solo salen si quien pregunta trae
    // el secreto de operación.
    const opsSecret = process.env.ZELIXPAY_WEBHOOK_SECRET;
    const authHeader = _req.headers.authorization;
    const isOperator = Boolean(opsSecret) && authHeader === `Bearer ${opsSecret}`;

    res.status(status === 'healthy' ? 200 : 503).json({
      ok: status === 'healthy',
      status,
      version: '1.0.0',
      environment: providerRegistry.getEnvironment(),
      timestamp: new Date().toISOString(),
      database: databaseStatus,
      ...(isOperator
        ? { database_error: databaseError, providers: providerHealth }
        : {
            providers: Object.fromEntries(
              Object.entries(providerHealth).map(([name, health]) => [name, { healthy: health.healthy }]),
            ),
          }),
    });
  }
}

export const paymentController = new PaymentController();
