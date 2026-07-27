import { logger } from '../lib/logger.js';

let alreadyValidated = false;

function hasRealValue(value: string | undefined, placeholders: string[] = []) {
  if (!value || value.trim() === '') return false;
  return !placeholders.some((placeholder) => value.includes(placeholder));
}

function addRequired(errors: string[], name: string, placeholders: string[] = []) {
  if (!hasRealValue(process.env[name], placeholders)) {
    errors.push(`${name} is required`);
  }
}

export function validateEnvironment() {
  if (alreadyValidated) return;
  alreadyValidated = true;

  const errors: string[] = [];
  const warnings: string[] = [];
  const paymentEnvironment = process.env.PAYMENT_ENVIRONMENT || 'sandbox';
  const strictMode = process.env.ENV_VALIDATION_MODE === 'strict'
    || process.env.NODE_ENV === 'production'
    || paymentEnvironment === 'production';

  addRequired(errors, 'DATABASE_URL');
  addRequired(errors, 'APP_URL');
  addRequired(errors, 'ZELIX_DATABASE_URL');

  const simulatorDemo = process.env.PAYMENT_SIMULATOR_DEMO === 'true';
  // Opt-in EXPLÍCITO para correr un demo (pagos simulados) sobre un deployment
  // marcado como producción. Sin este flag, un demo en prod es un error de
  // arranque: evita que un prod "real" quede sirviendo pagos simulados.
  const allowDemoInProd = process.env.ALLOW_DEMO_IN_PROD === 'true';

  if (paymentEnvironment === 'production') {
    if (!process.env.APP_URL?.startsWith('https://')) {
      errors.push('APP_URL must be https in PAYMENT_ENVIRONMENT=production');
    }
    if (simulatorDemo) {
      if (allowDemoInProd) {
        warnings.push('PAYMENT_SIMULATOR_DEMO activo con ALLOW_DEMO_IN_PROD=true: pagos simulados en producción.');
      } else {
        errors.push('PAYMENT_SIMULATOR_DEMO está activo en PAYMENT_ENVIRONMENT=production. Apágalo para prod real, o pon ALLOW_DEMO_IN_PROD=true si el demo es intencional.');
      }
    }
    if (!simulatorDemo) {
      // Prod real (Flow despierto): exigir credenciales reales.
      if ((process.env.PAYMENT_DEFAULT_PROVIDER || 'flow') !== 'flow') {
        errors.push('PAYMENT_DEFAULT_PROVIDER must be flow');
      }
      addRequired(errors, 'FLOW_API_KEY', ['change_me']);
      addRequired(errors, 'FLOW_SECRET_KEY', ['change_me']);
    }

    // Blindaje de pagos: en producción, las rutas que mueven dinero sin firma de
    // pasarela no pueden quedar abiertas. Sin estos secretos el server responde
    // 503 en esas rutas (fail-closed), pero es mejor que no arranque a que quede
    // sirviendo pagos con la puerta de reversas cerrada por accidente.
    addRequired(errors, 'ZELIXPAY_WEBHOOK_SECRET', ['change_me']);
    addRequired(errors, 'CRON_SECRET', ['change_me']);

    const webhookSecret = process.env.ZELIXPAY_WEBHOOK_SECRET;
    if (webhookSecret && webhookSecret.length < 32) {
      errors.push('ZELIXPAY_WEBHOOK_SECRET debe tener al menos 32 caracteres');
    }

    if (!process.env.CORS_ALLOWED_ORIGINS) {
      warnings.push('CORS_ALLOWED_ORIGINS no configurado: se usa la lista por defecto (zelix.cl).');
    }
  }

  for (const warning of warnings) {
    logger.warn('Environment warning', { warning });
  }

  if (errors.length > 0) {
    const message = `Invalid ZelixPay environment: ${errors.join('; ')}`;
    if (strictMode) {
      logger.error(message, { errors });
      throw new Error(message);
    }
    logger.warn(message, { errors });
  } else {
    logger.info('Environment validation passed', {
      nodeEnv: process.env.NODE_ENV || 'development',
      paymentEnvironment,
      strictMode,
    });
  }
}
