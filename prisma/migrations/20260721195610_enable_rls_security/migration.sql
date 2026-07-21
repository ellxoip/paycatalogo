-- Seguridad: habilitar Row-Level Security en TODAS las tablas del schema public
-- (advisor de Supabase: rls_disabled_in_public). SIN policies → la API pública
-- (anon/authenticated vía PostgREST) queda BLOQUEADA; el backend (rol `postgres`,
-- bypassrls, vía Prisma/DATABASE_URL) sigue con acceso total. Idempotente.
ALTER TABLE "Order"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentAttempt"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentReversal"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillingDocument"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationOutbox"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationLog"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeadLetterQueue"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReconciliationRun"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupportTicket"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
