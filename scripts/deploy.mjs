#!/usr/bin/env node
/**
 * Despliegue a Render con puerta de calidad: `npm run deploy`.
 *
 * Por qué existe: el auto-deploy nativo de Render NUNCA funcionó en este repo
 * (su GitHub App tiene acceso a ellxoip/Zelix pero no a este), y nadie lo notó
 * porque un deploy que no ocurre no avisa. El servicio estuvo 11 días sirviendo
 * código viejo con commits ya en master.
 *
 * Hace lo que el auto-deploy no hacía:
 *   1. No despliega si el typecheck o los tests fallan — este servicio cobra
 *      dinero real; subir código roto a la pasarela es peor que no subir nada.
 *   2. Espera a que el deploy quede 'live' en vez de dar por buena la petición.
 *   3. Verifica /api/health después: base conectada, entorno production y —lo
 *      más importante— que el simulador de pagos NO esté registrado. Un
 *      simulador vivo en producción son pagos que se aprueban solos.
 *
 * Requiere RENDER_API_KEY en el entorno (o en el .env del repo raíz de zelix).
 * Uso: npm run deploy            → verifica y despliega
 *      npm run deploy -- --check → solo verifica, no despliega
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const SERVICE_ID = process.env.RENDER_SERVICE_ID || 'srv-d9c1v8favr4c73a5k3u0';
const HEALTH_URL = process.env.DEPLOY_HEALTH_URL || 'https://zelixpay.onrender.com/api/health';
const soloVerificar = process.argv.includes('--check');

function apiKey() {
  if (process.env.RENDER_API_KEY) return process.env.RENDER_API_KEY;
  // Comodidad: la llave vive en el .env del repo raíz de zelix (este repo es aparte).
  for (const ruta of ['../.env', '../../.env']) {
    if (!existsSync(ruta)) continue;
    const m = readFileSync(ruta, 'utf8').match(/^(?:export )?RENDER_API_KEY=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

function paso(titulo, fn) {
  process.stdout.write(`\n▸ ${titulo}\n`);
  return fn();
}

const KEY = apiKey();
if (!KEY) {
  console.error('✗ Falta RENDER_API_KEY (en el entorno o en el .env del repo raíz).');
  process.exit(1);
}

const api = (ruta, init = {}) =>
  fetch(`https://api.render.com/v1${ruta}`, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });

// --- 1. Puerta de calidad ---------------------------------------------------
paso('Typecheck', () => execSync('npm run lint', { stdio: 'inherit' }));
paso('Tests', () => execSync('npm test', { stdio: 'inherit' }));

// --- 2. Aviso si hay trabajo sin subir --------------------------------------
paso('Estado del repo', () => {
  const sucio = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
  if (sucio) {
    console.log('  ⚠ Hay cambios sin commitear: Render despliega lo que está en GitHub, no tu disco.');
    console.log(sucio.split('\n').map((l) => `    ${l}`).join('\n'));
  }
  const local = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  let remoto = '';
  try {
    execSync('git fetch --quiet origin master');
    remoto = execSync('git rev-parse origin/master', { encoding: 'utf8' }).trim();
  } catch { /* sin red: se avisa igual más abajo */ }
  if (remoto && local !== remoto) {
    console.log(`  ⚠ HEAD local (${local.slice(0, 7)}) ≠ origin/master (${remoto.slice(0, 7)}): haz push antes de desplegar.`);
  } else if (remoto) {
    console.log(`  ✓ En sincronía con origin/master (${remoto.slice(0, 7)}).`);
  }
});

if (soloVerificar) {
  console.log('\n(--check: verificado, nada desplegado)');
  process.exit(0);
}

// --- 3. Deploy y espera -----------------------------------------------------
const deployId = await paso('Lanzando deploy en Render', async () => {
  const res = await api(`/services/${SERVICE_ID}/deploys`, {
    method: 'POST',
    body: JSON.stringify({ clearCache: 'do_not_clear' }),
  });
  if (!res.ok) {
    console.error(`  ✗ Render respondió ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const { id } = await res.json();
  console.log(`  deploy ${id}`);
  return id;
});

await paso('Esperando a que quede en vivo', async () => {
  for (let i = 1; i <= 60; i++) {
    const { status } = await api(`/services/${SERVICE_ID}/deploys/${deployId}`).then((r) => r.json());
    console.log(`  [${i}] ${status}`);
    if (status === 'live') return;
    if (['build_failed', 'update_failed', 'canceled', 'pre_deploy_failed'].includes(status)) {
      console.error(`  ✗ El deploy terminó en '${status}'.`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  console.error('  ✗ Timeout esperando el deploy.');
  process.exit(1);
});

// --- 4. Verificación de que lo desplegado está sano --------------------------
await paso('Verificando el servicio', async () => {
  let salud = null;
  for (let i = 0; i < 5 && !salud; i++) {
    try {
      salud = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(30000) }).then((r) => r.json());
    } catch {
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
  if (!salud) {
    console.error('  ✗ El servicio no respondió al health check.');
    process.exit(1);
  }

  const problemas = [];
  if (salud.database !== 'connected') problemas.push(`base de datos: ${salud.database}`);
  if (salud.environment !== 'production') problemas.push(`entorno: ${salud.environment}`);
  if (salud.providers && 'simulator' in salud.providers) problemas.push('el simulador de pagos está REGISTRADO');

  console.log(`  entorno: ${salud.environment} | base: ${salud.database} | proveedores: ${Object.keys(salud.providers || {}).join(', ')}`);
  if (problemas.length) {
    console.error(`  ✗ ${problemas.join('; ')}`);
    process.exit(1);
  }
  console.log('  ✓ Producción, base conectada, solo Flow.');
});

console.log('\n✓ Desplegado y verificado.');
