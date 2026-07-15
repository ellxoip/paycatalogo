# ZelixPay — carrito de compras de Zelix

Carrito de compras que lee el catálogo real de cada PYME (`perfiles.pyme_context.productos`
en la base de Zelix) y procesa el pago vía **Flow** (hoy en modo simulado/dormido, a la espera
de credenciales reales). Se aloja en `www.zelix.cl/pay`.

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
- React 19, TypeScript, Vite (`base: '/pay/'`)
- Tailwind CSS v4, Lucide React
- React Router v7 (`basename="/pay"`)

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
npm run dev      # Frontend (puerto 3003, sirve bajo /pay/)
```

Probar el catálogo real de una PYME:
```
http://localhost:3003/pay/?pyme=<pyme_id de la tabla perfiles>
```

### Health Check
```bash
curl http://localhost:4000/api/health
```

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
