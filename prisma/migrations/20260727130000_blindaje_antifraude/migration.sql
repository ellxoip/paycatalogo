-- Blindaje antifraude (card testing) — huella de origen de cada pedido.
-- fraudGuard mide velocidad por IP: ráfagas, barrido de comercios y racha de
-- rechazos. Sin estas columnas no hay nada que medir.
-- Aditiva y nullable: los pedidos históricos quedan como están.

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cliente_ip" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cliente_user_agent" TEXT;

-- Índice compuesto: todas las consultas de fraudGuard son "esta IP, desde esta
-- hora". Sin él, cada checkout haría un seq scan sobre Order.
CREATE INDEX IF NOT EXISTS "Order_cliente_ip_created_at_idx" ON "Order" ("cliente_ip", "created_at");
