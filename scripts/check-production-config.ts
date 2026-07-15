import dotenv from 'dotenv';

dotenv.config();

type Check = {
  name: string;
  ok: boolean;
  message: string;
};

function hasValue(name: string) {
  return Boolean(process.env[name]?.trim());
}

function isPublicHttpsUrl(value?: string) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      host !== 'localhost' &&
      host !== '127.0.0.1' &&
      !host.endsWith('.local')
    );
  } catch {
    return false;
  }
}

const checks: Check[] = [
  {
    name: 'PAYMENT_ENVIRONMENT',
    ok: process.env.PAYMENT_ENVIRONMENT === 'production',
    message: 'Debe ser "production" para cobros reales.',
  },
  {
    name: 'APP_URL',
    ok: isPublicHttpsUrl(process.env.APP_URL),
    message: 'Debe ser una URL publica HTTPS, sin localhost.',
  },
  {
    name: 'DATABASE_URL',
    ok: hasValue('DATABASE_URL'),
    message: 'Debe apuntar a la base de zelixpay (Order/Payment).',
  },
  {
    name: 'ZELIX_DATABASE_URL',
    ok: hasValue('ZELIX_DATABASE_URL') || hasValue('DATABASE_URL'),
    message: 'Debe apuntar a la base de Zelix (perfiles.pyme_context) para leer el catálogo.',
  },
  {
    name: 'PAYMENT_DEFAULT_PROVIDER',
    ok: (process.env.PAYMENT_DEFAULT_PROVIDER || 'flow') === 'flow',
    message: 'Debe ser flow; zelixpay solo opera con Flow.',
  },
  {
    name: 'FLOW_API_KEY',
    ok: hasValue('FLOW_API_KEY') && !process.env.FLOW_API_KEY?.includes('change_me'),
    message: 'Debe ser la API Key productiva de Flow.',
  },
  {
    name: 'FLOW_SECRET_KEY',
    ok: hasValue('FLOW_SECRET_KEY') && !process.env.FLOW_SECRET_KEY?.includes('change_me'),
    message: 'Debe ser la Secret Key productiva de Flow.',
  },
];

const failed = checks.filter((check) => !check.ok);

console.log('\nZelixPay production payment configuration\n');
for (const check of checks) {
  console.log(`${check.ok ? 'OK ' : 'ERR'} ${check.name} - ${check.message}`);
}

if (failed.length > 0) {
  console.error(`\n${failed.length} configuration check(s) failed. Do not run real charges yet.`);
  process.exit(1);
}

console.log('\nConfiguration is ready for a controlled real payment test.');
