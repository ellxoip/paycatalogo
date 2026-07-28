# ZelixPay — carrito de compras de Zelix

Carrito de compras que lee el catálogo real de cada PYME (`perfiles.pyme_context.productos`
en la base de Zelix) y procesa el pago vía **Flow** (hoy en modo simulado/dormido, a la espera
de credenciales reales). Se aloja en `www.zelix.cl/catalogo/pay`.

Nace como una reproposición completa del proyecto "PagaCuotas" (portal de cuotas de deuda):
se conservó la capa de proveedor de pago (Flow + simulador) y la infraestructura genérica
(`IntegrationLog`, `IntegrationOutbox`), y se reemplazó todo el dominio de deuda/cuotas por
`Order`/`OrderItem` sobre el catálogo de productos de Zelix.

---

## Stack Tecnológico

**Backend (API Rest):**
- Node.js, Express, TypeScript
- Prisma + PostgreSQL (Supabase) — propio de zelixpay (`Order`, `Payment`, etc.)
- `pg` directo, solo lectura — contra la base de Zelix (`perfiles.pyme_context`)
- Validación: Zod

**Frontend (carrito):**
- React 19, TypeScript, Vite (`base: '/catalogo/pay/'`)
- Tailwind CSS v4, Lucide React
- React Router v7 (`basename="/catalogo/pay"`)

---

## Arquitectura

### Catálogo (solo lectura)
`server/services/catalog.service.ts` lee `perfiles.pyme_context` desde la misma base
Postgres/Supabase que usa Zelix (`ZELIX_DATABASE_URL`), sin escribir nunca ahí. El precio de
cada producto es texto libre (`"$12.990"` o `null`) — `parsePrecio` extrae el número; sin
precio publicado, el producto no se puede agregar al carrito.

### Carrito -> Orden -> Pago
El carrito vive en `sessionStorage` del navegador (`src/lib/cart.ts`). Al hacer checkout,
`POST /api/orders` crea un `Order` + `OrderItem[]` (snapshot de nombre/precio, porque el
catálogo de origen es JSONB mutable) y abre una intención de pago con el proveedor
configurado (Flow o `simulator`).

### Capa de proveedor de pago
`server/providers/` — abstracción `IPaymentProvider` agnóstica de dominio, con Flow
(`flow.provider.ts`, dormido hasta tener `FLOW_API_KEY`/`FLOW_SECRET_KEY` reales) y un
simulador para desarrollo/QA sin pasarela real.

---

## Configuración

### 1. Instalar dependencias
```bash
npm install
```

### 2. Variables de Entorno
Copia `.env.example` a `.env` y completa `DATABASE_URL` (base propia de zelixpay) y
`ZELIX_DATABASE_URL` (base de Zelix, para el catálogo).

### 3. Preparar Base de Datos
```bash
npx prisma generate
npx prisma migrate dev --name init_zelixpay
# Opcional: aplicar prisma/rls_policies.sql en el SQL Editor de Supabase
```

---

## Ejecución

```bash
npm run server   # API (puerto 4000)
npm run dev      # Frontend (puerto 3003, sirve bajo /catalogo/pay/)
```

Probar el catálogo real de una PYME:
```
http://localhost:3003/catalogo/pay/?pyme=<pyme_id de la tabla perfiles>
```

### Health Check
```bash
curl http://localhost:4000/api/health
```

`/health` es solo liveness (el proceso responde). `/api/health` es el chequeo
real: consulta Postgres y los proveedores de pago. **No volver a montar un
handler de `/api/health` en `app.ts`**: se registraría antes que el router y
taparía el chequeo real, dejando el monitoreo diciendo "ok" con la base caída
(pasó, y estuvo así hasta el 2026-07-27).

---

## Despliegue

**Fuente de verdad: GitHub Actions** (`.github/workflows/deploy.yml`), disparado
por push a `master`. El trabajo real lo hace `scripts/deploy.mjs` — el mismo que
corre `npm run deploy` en local — para que el camino automático y el manual no
puedan divergir.

```bash
npm run deploy          # verifica, despliega y comprueba (break-glass local)
npm run deploy:check    # solo typecheck + tests + estado, sin desplegar
npm run deploy:status   # ¿producción está al día? (sale 1 si hay drift)
```

El procedimiento, en ambos caminos:

1. `tsc --noEmit` y la suite de tests. **Si algo falla, no se despliega.**
2. Reporta drift: compara el commit vivo en Render contra `origin/master` y
   lista los commits pendientes.
3. Lanza el deploy por la API de Render y **espera** a que quede `live`.
4. Verifica `/api/health`: base conectada, `environment: production` y que el
   simulador de pagos **no** esté registrado (un simulador vivo en producción
   son pagos que se aprueban solos).
5. Confirma que el commit vivo quedó igual a `origin/master`.

### Por qué NO se usa el auto-deploy nativo de Render

Nunca funcionó en este repositorio. Evidencia del 2026-07-27: 7 deploys
históricos del servicio, **ninguno con trigger `new_commit`** (1 `manual` +
6 `api`), mientras el servicio hermano `zelix` acumula 45 `new_commit`. La
GitHub App de Render tiene acceso a `ellxoip/Zelix` pero nunca lo tuvo a
`ellxoip/paycatalogo`, y el repo no tiene webhooks. El `autoDeploy: yes` del
panel era una promesa vacía: dejó **11 días** de código del 16/07 sirviendo en
producción —con la costura `order.paid` entre lo no desplegado— sin una sola
alerta, porque un deploy que no ocurre no avisa.

El flag quedó en **`autoDeploy: no`** deliberadamente. Si alguien reconecta la
GitHub App de Render a este repo, **no volver a encenderlo**: el auto-deploy
nativo despliega cualquier cosa que se empuje, incluido código que no compila, a
un servicio que cobra dinero real. Dos mecanismos activos significan que el
camino sin tests gana la carrera.

### Dónde vive el servicio (y por qué ahí)

| | |
|---|---|
| Workspace Render | **Zelix Pagos** (`tea-d9kb8gn10e5c73arahb0`) |
| Servicio | `srv-d9kfrgh42hec73aq17h0` |
| URL | `https://zelixpay-qy3w.onrender.com` |
| Público | `www.zelix.cl/catalogo/pay` (proxy Cloudflare, repo `Zelix`) |

Vive **solo** en su workspace a propósito. Render asigna 750 h de instancia al
mes por workspace y, al agotarlas, suspende todos los servicios free de ese
workspace hasta el día 1. Mientras pagos y WhatsApp compartían presupuesto,
ninguno podía estar despierto todo el día sin arriesgar apagar al otro. Ahora
cada uno tiene sus 750 h y el keep-alive corre 23 h/día (713 h, margen 3,6%).

Render **no permite transferir servicios entre workspaces**: hubo que recrear
éste por API (`POST /v1/services`) el 2026-07-28. El servicio anterior
(`srv-d9c1v8favr4c73a5k3u0`, `zelixpay.onrender.com`) quedó **suspendido**, no
borrado, por si hiciera falta volver.

Si algún día hay que repetir la mudanza, la URL nueva vive en cuatro lugares y
los cuatro deben moverse en el mismo acto: `APP_URL` del servicio (la que Flow
usa para `urlConfirmation`), `ZELIXPAY_ORIGIN` en el proxy de Cloudflare, el
secreto `RENDER_SERVICE_ID` en GitHub, y las URLs de los workflows y de
`scripts/deploy.mjs`.

### Secretos requeridos en el repositorio

| Secreto | Para qué |
|---|---|
| `RENDER_API_KEY` | Autenticar contra la API de Render |
| `RENDER_SERVICE_ID` | Identificar el servicio a desplegar |

---

## Estructura de Directorios

```
server/
├── providers/      # Abstracción de pasarelas de pago (Flow, simulador)
├── services/       # catalog.service.ts, payment.service.ts, outbox.service.ts
├── controllers/    # Handlers de Express
├── routes/         # Definición de rutas API
└── validators/     # Esquemas Zod

src/
├── lib/cart.ts     # Carrito en sessionStorage + llamadas a la API
└── pages/client/   # Catalog.tsx (catálogo) y Checkout.tsx (carrito/pago)

prisma/
├── schema.prisma       # Order/OrderItem/PaymentAttempt/Payment/...
├── migrations/
└── rls_policies.sql
```
