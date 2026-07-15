import prisma from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

const POLL_INTERVAL_MS = Number(process.env.OUTBOX_POLL_INTERVAL_MS || 60_000);
const BATCH_SIZE = Number(process.env.OUTBOX_BATCH_SIZE || 50);
const MAX_RETRIES = Number(process.env.OUTBOX_MAX_RETRIES || 10);

type OutboxHandler = (payload: any, aggregateId: string) => Promise<void>;

export class OutboxService {
  private handlers = new Map<string, OutboxHandler>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  registerHandler(eventType: string, handler: OutboxHandler) {
    this.handlers.set(eventType, handler);
  }

  async enqueue(params: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    idempotencyKey: string;
    payload: unknown;
  }) {
    return prisma.integrationOutbox.upsert({
      where: { idempotency_key: params.idempotencyKey },
      update: {},
      create: {
        event_type: params.eventType,
        aggregate_type: params.aggregateType,
        aggregate_id: params.aggregateId,
        idempotency_key: params.idempotencyKey,
        payload_json: params.payload as any,
      },
    });
  }

  async markPublished(idempotencyKey: string) {
    await prisma.integrationOutbox.updateMany({
      where: { idempotency_key: idempotencyKey },
      data: { status: 'published', last_error: null, next_attempt_at: null },
    });
  }

  async markFailed(idempotencyKey: string, errorMessage: string, retryCount: number) {
    const nextRetry = retryCount + 1;
    const exhausted = nextRetry >= MAX_RETRIES;
    const backoffMs = Math.min(60 * 60 * 1000, Math.pow(2, nextRetry) * 60_000); // capped at 1h
    await prisma.integrationOutbox.updateMany({
      where: { idempotency_key: idempotencyKey },
      data: {
        status: exhausted ? 'dead' : 'failed',
        last_error: errorMessage,
        retry_count: { increment: 1 },
        next_attempt_at: exhausted ? null : new Date(Date.now() + backoffMs),
      },
    });
  }

  async processOnce() {
    if (this.running) return { processed: 0, skipped: true };
    this.running = true;
    const stats = { processed: 0, published: 0, failed: 0 };

    try {
      const now = new Date();
      const events = await prisma.integrationOutbox.findMany({
        where: {
          status: { in: ['pending', 'failed'] },
          OR: [{ next_attempt_at: null }, { next_attempt_at: { lte: now } }],
        },
        orderBy: { created_at: 'asc' },
        take: BATCH_SIZE,
      });

      for (const event of events) {
        stats.processed += 1;
        const handler = this.handlers.get(event.event_type);
        if (!handler) {
          logger.warn('Outbox event has no registered handler', { eventType: event.event_type });
          await this.markFailed(event.idempotency_key, `No handler for ${event.event_type}`, event.retry_count);
          stats.failed += 1;
          continue;
        }

        try {
          const payload = event.payload_json;
          await handler(payload, event.aggregate_id);
          await this.markPublished(event.idempotency_key);
          stats.published += 1;
        } catch (error: any) {
          logger.error('Outbox event publish failed', {
            eventType: event.event_type,
            idempotencyKey: event.idempotency_key,
            error: error.message,
          });
          await this.markFailed(event.idempotency_key, error.message || String(error), event.retry_count);
          stats.failed += 1;
        }
      }

      return stats;
    } finally {
      this.running = false;
    }
  }

  start() {
    if (this.timer) return;
    logger.info('Outbox worker starting', { pollIntervalMs: POLL_INTERVAL_MS, batchSize: BATCH_SIZE });
    const tick = () => {
      this.processOnce()
        .then((stats) => {
          if (stats.processed > 0) {
            logger.info('Outbox worker tick completed', stats);
          }
        })
        .catch((error) => {
          logger.error('Outbox worker tick failed', { error: error.message });
        });
    };
    // First tick after startup, then every interval
    this.timer = setInterval(tick, POLL_INTERVAL_MS);
    setTimeout(tick, 5_000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const outboxService = new OutboxService();
