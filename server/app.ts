import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import dotenv from 'dotenv';
import apiRoutes from './routes/api.routes.js';
import { validateEnvironment } from './config/env.js';
import { logger } from './lib/logger.js';

dotenv.config();
validateEnvironment();

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

// Health / readiness check — sin auth, para orquestación y monitoreo.
const healthHandler = (_req: express.Request, res: express.Response) =>
  res.json({ status: 'ok', service: 'zelixpay-api', uptime: process.uptime() });
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// Routes
app.use('/api', apiRoutes);

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
