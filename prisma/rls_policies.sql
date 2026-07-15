-- ============================================================
-- ZelixPay (carrito) — Row Level Security
-- Run this in Supabase SQL Editor (Settings > SQL Editor)
-- ============================================================
-- Strategy:
--   • postgres role (Prisma/backend) = superuser → bypasses RLS natively
--   • anon role (direct Supabase client) = blocked entirely
--   • El checkout es anónimo (sin sesión de cliente): no hay aislamiento por
--     usuario que expresar en RLS, así que las tablas quedan cerradas al rol
--     anon y todo el acceso pasa por el backend Express.
-- ============================================================

ALTER TABLE "Order"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentAttempt"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingDocument"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentReversal"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationLog"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationOutbox"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeadLetterQueue"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReconciliationRun"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportTicket"      ENABLE ROW LEVEL SECURITY;

-- Todas las tablas quedan sin policy para el rol anon = deny por defecto.
-- Si en una fase futura el checkout se engancha a la identidad del bot
-- (chat_id/teléfono del cliente Zelix), agregar aquí una policy de lectura
-- acotada a ese identificador, siguiendo el patrón `current_setting('app.*')`
-- que usaba PagaCuotas para el aislamiento por RUT.
