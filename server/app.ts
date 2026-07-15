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

// crossOriginResourcePolicy: las fotos de producto vienen de Supabase Storage
// (otro origen); el default 'same-origin' de helmet las bloquearía en el build.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

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
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    details: err.details || null,
  });
});

export default app;
