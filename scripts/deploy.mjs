#!/usr/bin/env node
/**
 * Despliegue a Render: `npm run deploy`.
 *
 * FUENTE DE VERDAD DEL DESPLIEGUE: GitHub Actions (.github/workflows/deploy.yml).
 * Este script es el MISMO procedimiento en forma de comando local, y cumple dos
 * roles: (a) break-glass cuando Actions no está disponible, (b) el motor que el
 * propio workflow reusa. No son dos mecanismos que puedan divergir: son el mismo
 * código, invocado desde dos lugares.
 *
 * Por qué no se usa el auto-deploy nativo de Render: no existía. Evidencia del
 * 2026-07-27 — 7 deploys históricos de este servicio, CERO con trigger
 * `new_commit` (1 `manual` + 6 `api`), mientras el servicio hermano `zelix`
 * acumula 45 `new_commit`. La GitHub App de Render nunca tuvo acceso a este
 * repositorio; el `autoDeploy: yes` del panel era una promesa vacía que dejó 11
 * días de código viejo en producción sin una sola alerta. Ese flag quedó en `no`
 * a propósito: si algún día se reconecta la App, no debe aparecer un segundo
 * camino que despliegue SIN pasar por los tests.
 *
 * Garantías que aporta y el auto-deploy nativo no daba:
 *   1. No despliega si el typecheck o los tests fallan — este servicio cobra
 *      dinero real; subir código roto a la pasarela es peor que no subir nada.
 *   2. Detecta DRIFT: compara el commit vivo en Render contra origin/master, así
 *      que "producción quedó vieja" es un estado visible, no un silencio.
 *   3. Espera a que el deploy quede 'live' en vez de dar por buena la petición.
 *   4. Verifica /api/health después: base conectada, entorno production y —lo
 *      más importante— que el simulador de pagos NO esté registrado. Un
 *      simulador vivo en producción son pagos que se aprueban solos.
 *
 * Requiere RENDER_API_KEY en el entorno (o en el .env del repo raíz de zelix).
 * Uso: npm run deploy          → verifica, despliega y comprueba
 *      npm run deploy:check    → solo la puerta de calidad, no despliega
 *      npm run deploy:status   → ¿producción está al día? (sale 1 si hay drift)
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const SERVICE_ID = process.env.RENDER_SERVICE_ID || 'srv-d9c1v8favr4c73a5k3u0';
const HEALTH_URL = process.env.DEPLOY_HEALTH_URL || 'https://zelixpay.onrender.com/api/health';
const soloVerificar = process.argv.includes('--check');
const soloEstado = process.argv.includes('--status');

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

/** Commit que Render tiene efectivamente en vivo (no el que alguien cree). */
async function commitEnVivo() {
  const res = await api(`/services/${SERVICE_ID}/deploys?limit=20`);
  if (!res.ok) return null;
  const deploys = await res.json();
  const vivo = deploys.find((d) => d.deploy?.status === 'live');
  return vivo?.deploy?.commit?.id || null;
}

/**
 * Drift = lo que está en GitHub no es lo que está sirviendo producción. Es
 * exactamente la falla que estuvo 11 días invisible, así que aquí es un estado
 * REPORTADO, con la lista de commits que faltan.
 */
async function reportarDrift() {
  let remoto = null;
  try {
    execSync('git fetch --quiet origin master');
    remoto = execSync('git rev-parse origin/master', { encoding: 'utf8' }).trim();
  } catch {
    console.log('  ⚠ Sin acceso a origin: no se pudo comparar con GitHub.');
    return { hayDrift: false, indeterminado: true };
  }

  const vivo = await commitEnVivo();
  if (!vivo) {
    console.log('  ⚠ Render no reporta ningún deploy en vivo.');
    return { hayDrift: true, indeterminado: true };
  }

  if (vivo === remoto) {
    console.log(`  ✓ Producción al día: ${vivo.slice(0, 7)} == origin/master`);
    return { hayDrift: false, indeterminado: false };
  }

  console.log(`  ✗ DRIFT — Render sirve ${vivo.slice(0, 7)}, GitHub tiene ${remoto.slice(0, 7)}`);
  try {
    const pendientes = execSync(`git log --oneline ${vivo}..${remoto}`, { encoding: 'utf8' }).trim();
    if (pendientes) console.log(pendientes.split('\n').map((l) => `      ${l}`).join('\n'));
  } catch { /* el commit vivo puede no existir localmente */ }
  return { hayDrift: true, indeterminado: false };
}

// --- 0. Estado (modo consulta) ----------------------------------------------
if (soloEstado) {
  const { hayDrift } = await paso('¿Producción está al día?', reportarDrift);
  process.exit(hayDrift ? 1 : 0);
}

// --- 1. Puerta de calidad ---------------------------------------------------
paso('Typecheck', () => execSync('npm run lint', { stdio: 'inherit' }));
paso('Tests', () => execSync('npm test', { stdio: 'inherit' }));

// --- 2. Estado del repo y drift ---------------------------------------------
await paso('Estado del repo', async () => {
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
  } catch { /* sin red: el drift de abajo lo reporta igual */ }
  if (remoto && local !== remoto) {
    console.log(`  ⚠ HEAD local (${local.slice(0, 7)}) ≠ origin/master (${remoto.slice(0, 7)}): haz push antes de desplegar.`);
  } else if (remoto) {
    console.log(`  ✓ HEAD local en sincronía con origin/master (${remoto.slice(0, 7)}).`);
  }
  await reportarDrift();
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

// Confirmación final: que lo que quedó vivo sea exactamente lo que hay en
// GitHub. Un deploy "exitoso" del commit equivocado es el mismo problema con
// otra cara.
const { hayDrift } = await paso('Confirmando que no quedó drift', reportarDrift);
if (hayDrift) {
  console.error('\n✗ El deploy terminó pero producción NO coincide con origin/master.');
  process.exit(1);
}

console.log('\n✓ Desplegado y verificado.');
