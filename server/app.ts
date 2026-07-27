import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import apiRoutes from './routes/api.routes.js';
import { validateEnvironment } from './config/env.js';
import { logger } from './lib/logger.js';

dotenv.config();
validateEnvironment();

// Prefijo público del carrito (www.zelix.cl/catalogo/pay → proxy → este server).
// El frontend se buildea con base '/catalogo/pay/' (vite.config.ts) y llama a
// la API en `${VITE_API_BASE_URL}/api/...`, así que la API se monta en ambos
// prefijos: raíz (dev local, callbacks de pasarela) y bajo BASE_PATH (proxy).
const BASE_PATH = '/catalogo/pay';

const app = express();

// ZelixPay corre detrás del proxy de www.zelix.cl. Sin esto, req.ip es la IP del
// proxy y TODO el rate limiting compartiría una sola llave: el carding pasaría
// entero y los compradores reales se bloquearían entre sí. El 1 es el número de
// saltos de proxy confiables — subirlo de más permitiría falsear X-Forwarded-For.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));

// crossOriginResourcePolicy: las fotos de producto vienen de Supabase Storage
// (otro origen); el default 'same-origin' de helmet las bloquearía en el build.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS por lista blanca: `cors()` a secas deja que cualquier sitio llame a la
// API desde el navegador de un tercero. Los orígenes válidos son el propio
// portal y lo que se declare en CORS_ALLOWED_ORIGINS (coma separada).
const allowedOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS || 'https://www.zelix.cl,https://zelix.cl')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean),
);
const corsPermisivo = process.env.PAYMENT_ENVIRONMENT !== 'production';
app.use(
  cors({
    origin(origin, callback) {
      // Sin Origin = misma página, curl, o el server-to-server de Flow: no es
      // una petición cross-origin del navegador, no le aplica CORS.
      if (!origin) return callback(null, true);
      const normalized = origin.replace(/\/+$/, '');
      if (allowedOrigins.has(normalized) || corsPermisivo) return callback(null, true);
      logger.warn('CORS: origen rechazado', { origin });
      return callback(null, false);
    },
    credentials: false,
  }),
);

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
// 100kb basta de sobra para un carrito; 2mb le regalaba a un atacante 20x más
// carga por request en el mismo número de conexiones.
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// Health / readiness check — sin auth, para orquestación y monitoreo.
const healthHandler = (_req: express.Request, res: express.Response) =>
  res.json({ status: 'ok', service: 'zelixpay-api', uptime: process.uptime() });
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);
app.get(`${BASE_PATH}/api/health`, healthHandler);

// API (raíz y bajo el prefijo público)
app.use('/api', apiRoutes);
app.use(`${BASE_PATH}/api`, apiRoutes);

// SPA (build de Vite) — solo si existe dist/ (en dev el frontend corre en Vite :3003).
const distDir = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(distDir)) {
  app.use(BASE_PATH, express.static(distDir, { maxAge: '1h', index: 'index.html' }));
  // Fallback SPA (sintaxis wildcard de Express 4): ruta del carrito sin archivo → index.html
  app.get(`${BASE_PATH}/*`, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
  // Comodidad: la raíz del servicio redirige al carrito
  app.get('/', (_req, res) => res.redirect(BASE_PATH + '/'));
} else {
  logger.info('dist/ no existe — sirviendo solo la API (modo dev)');
}

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled API error', {
    path: req.path,
    method: req.method,
    error: err,
  });
  // En producción no se devuelve el mensaje crudo del error: los stacks de
  // Prisma incluyen nombres de tabla y fragmentos de la cadena de conexión.
  const exponerDetalle = process.env.PAYMENT_ENVIRONMENT !== 'production' && process.env.NODE_ENV !== 'production';
  res.status(err.status || 500).json({
    error: exponerDetalle ? err.message || 'Internal Server Error' : 'Internal Server Error',
    details: exponerDetalle ? err.details || null : null,
  });
});

export default app;
