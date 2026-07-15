// Preload de variables de entorno. DEBE importarse ANTES que cualquier otro
// módulo que lea process.env a nivel de módulo (ej. CLIENT_PORTAL_BASE_URL,
// SIS_CONTABLE_BASE_URL, etc.).
//
// Por qué existe este archivo:
// En ESM los `import` se hoistean y se evalúan antes que el cuerpo del módulo,
// así que un `dotenv.config()` escrito en index.ts/app.ts corre DESPUÉS de que
// los módulos importados ya capturaron sus constantes desde process.env. Eso
// hacía que los overrides de .env.local se cargaran demasiado tarde y quedaran
// sin efecto (síntoma: el link del portal apuntaba a :3002 pese a configurar
// :3003 en .env.local). Centralizar la carga acá y ponerlo como PRIMER import
// del grafo garantiza que el env esté listo antes de todo.
//
// `override: true` en .env.local es obligatorio: sin él dotenv no reemplaza
// claves ya definidas por .env.
import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.local', override: true });
