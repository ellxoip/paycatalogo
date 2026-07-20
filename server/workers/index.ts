import { outboxService } from '../services/outbox.service.js';
import { logger } from '../lib/logger.js';
import { publishOrderPaid } from './orderPaidHandler.js';

const OUTBOX_WORKER_ENABLED = process.env.OUTBOX_WORKER_ENABLED !== 'false';

// Costura order.paid (§10.8, 2.1): al pagarse una orden, payment.service la encola
// en el outbox; este handler la publica (POST firmado) al receptor de Zelix.
export function registerOutboxHandlers() {
  outboxService.registerHandler('order.paid', (payload) => publishOrderPaid(payload as Parameters<typeof publishOrderPaid>[0]));
}

export function startBackgroundWorkers() {
  if (!OUTBOX_WORKER_ENABLED) {
    logger.info('Outbox worker disabled via OUTBOX_WORKER_ENABLED=false');
    return;
  }
  outboxService.start();
}
