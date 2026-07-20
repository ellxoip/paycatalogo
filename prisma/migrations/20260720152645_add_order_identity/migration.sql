-- §10.8 2.2 — cadena de identidad: la Order guarda a quién le vende y por qué canal,
-- para que un pago pueda unirse a la conversación del cliente en Zelix.
ALTER TABLE "Order" ADD COLUMN "cliente_chat_id" TEXT;
ALTER TABLE "Order" ADD COLUMN "canal_origen" TEXT;
