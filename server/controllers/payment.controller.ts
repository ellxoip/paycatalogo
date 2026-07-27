import { Request, Response } from 'express';
import prisma from '../lib/prisma.js';
import { paymentService } from '../services/payment.service.js';
import { catalogService } from '../services/catalog.service.js';
import { providerRegistry } from '../providers/index.js';
import { logger } from '../lib/logger.js';
import { clientIp, clientUserAgent } from '../lib/clientIp.js';

/**
 * Un error "de negocio" es el que NOSOTROS lanzamos a propósito (trae `status`):
 * su mensaje está escrito para el cliente y puede viajar tal cual. Cualquier
 * otro —Prisma, red, bug— lleva detalle de infraestructura: `invalid input
 * syntax for type uuid` le confirma a un atacante el motor de base y el tipo de
 * cada columna. Ese se registra completo y se responde en genérico.
 */
function responderError(res: Response, error: any, contexto: string) {
  const esDeNegocio = typeof error?.status === 'number';
  if (esDeNegocio) {
    res.status(error.status).json({ ok: false, code: error.code || 'ERROR', message: error.message });
    return;
  }
  logger.error(`Error inesperado en ${contexto}`, { error: error as Error, code: error?.code });
  res.status(500).json({
    ok: false,
    code: 'INTERNAL_ERROR',
    message: 'No pudimos procesar tu solicitud. Intenta nuevamente en un momento.',
  });
}

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
      responderError(res, error, 'getCatalog');
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
      responderError(res, error, 'createOrder');
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
      // El mensaje viaja en la URL del navegador del comprador: solo sale el
      // texto de un error nuestro; el de infraestructura queda en el log.
      logger.error('Callback de pasarela falló', { error: error as Error });
      const visible = typeof error?.status === 'number' ? error.message : 'No pudimos confirmar el pago.';
      res.redirect(`${clientBase}/checkout?result=error&message=${encodeURIComponent(visible)}`);
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
      responderError(res, error, 'webhook_error');
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
      responderError(res, error, 'webhook_error');
    }
  }

  async handleReversal(req: Request, res: Response) {
    try {
      const result = await paymentService.processReversal(req.body);
      res.json({ ok: true, result });
    } catch (error: any) {
      responderError(res, error, 'reversal_error');
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
