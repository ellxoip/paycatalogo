import { outboxService } from '../services/outbox.service.js';
import { logger } from '../lib/logger.js';

const OUTBOX_WORKER_ENABLED = process.env.OUTBOX_WORKER_ENABLED !== 'false';

// Sin handlers registrados por ahora: nada encola eventos al outbox en esta
// fase (no hay CRM/SIS.CONTABLE que sincronizar). Cuando exista un consumidor
// real (p.ej. notificar a Zelix que una orden se pagó), registrar el handler
// aquí y encolar el evento correspondiente en payment.service.ts.
export function registerOutboxHandlers() {}

export function startBackgroundWorkers() {
  if (!OUTBOX_WORKER_ENABLED) {
    logger.info('Outbox worker disabled via OUTBOX_WORKER_ENABLED=false');
    return;
  }
  outboxService.start();
}
