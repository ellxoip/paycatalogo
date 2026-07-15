import dotenv from 'dotenv';

dotenv.config();

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
const minLevel = LEVEL_WEIGHT[configuredLevel] ? configuredLevel : 'info';

function serializeContext(context?: Record<string, unknown>) {
  if (!context) return undefined;

  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.includes('password') || normalizedKey.includes('token') || normalizedKey.includes('secret') || normalizedKey.includes('key')) {
        return [key, '[redacted]'];
      }
      if (value instanceof Error) {
        return [key, { name: value.name, message: value.message, stack: value.stack }];
      }
      return [key, value];
    })
  );
}

function write(level: LogLevel, message: string, context?: Record<string, unknown>) {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minLevel]) return;

  const payload = {
    timestamp: new Date().toISOString(),
    level,
    service: 'zelixpay-api',
    message,
    ...serializeContext(context),
  };

  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => write('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => write('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => write('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => write('error', message, context),
};
