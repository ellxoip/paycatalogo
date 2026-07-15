// IMPORTANTE: este preload de env va PRIMERO, antes de cualquier otro import,
// para que .env/.env.local estén cargados antes de evaluar módulos que leen
// process.env a nivel de módulo. No reordenar.
import './load-env.js';
import app from './app.js';
import { registerOutboxHandlers, startBackgroundWorkers } from './workers/index.js';
import { logger } from './lib/logger.js';

const PORT = process.env.PORT || 4000;

registerOutboxHandlers();

app.listen(PORT, () => {
  logger.info('ZelixPay API running', { url: `http://localhost:${PORT}` });
  startBackgroundWorkers();
});
