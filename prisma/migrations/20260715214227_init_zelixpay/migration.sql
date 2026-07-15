-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "pyme_id" TEXT NOT NULL,
    "cliente_nombre" TEXT,
    "cliente_telefono" TEXT,
    "cliente_email" TEXT,
    "moneda" TEXT NOT NULL DEFAULT 'CLP',
    "total" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'creada',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "nombre_snapshot" TEXT NOT NULL,
    "precio_snapshot" DECIMAL(12,2) NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "external_attempt_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_transaction_id" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CLP',
    "method" TEXT,
    "status" TEXT NOT NULL,
    "request_payload_json" JSONB,
    "response_payload_json" JSONB,
    "provider_payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "external_payment_id" TEXT NOT NULL,
    "payment_attempt_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_transaction_id" TEXT,
    "transaction_number" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" TEXT,
    "status" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3),
    "receipt_url" TEXT,
    "billing_status" TEXT NOT NULL DEFAULT 'not_required',
    "billing_document_id" TEXT,
    "raw_provider_payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingDocument" (
    "id" TEXT NOT NULL,
    "external_billing_id" TEXT,
    "payment_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "sii_type" TEXT NOT NULL,
    "folio" TEXT,
    "track_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "recipient_rut" TEXT NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "recipient_email" TEXT,
    "net_amount" DECIMAL(12,2) NOT NULL,
    "tax_amount" DECIMAL(12,2) NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "pdf_url" TEXT,
    "xml_url" TEXT,
    "request_payload_json" JSONB,
    "response_payload_json" JSONB,
    "provider_payload_json" JSONB,
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "issued_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReversal" (
    "id" TEXT NOT NULL,
    "external_reversal_id" TEXT NOT NULL,
    "external_payment_id" TEXT NOT NULL,
    "external_attempt_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "amount_reversed" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "provider_reversal_code" TEXT,
    "reversed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentReversal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationLog" (
    "id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "endpoint" TEXT,
    "http_method" TEXT,
    "request_payload_json" JSONB,
    "response_payload_json" JSONB,
    "status" INTEGER,
    "duration_ms" INTEGER,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationOutbox" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeadLetterQueue" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_id" TEXT,
    "payload_json" JSONB,
    "error_message" TEXT NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeadLetterQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "payments_checked" INTEGER NOT NULL DEFAULT 0,
    "sis_retried" INTEGER NOT NULL DEFAULT 0,
    "crm_retried" INTEGER NOT NULL DEFAULT 0,
    "errors_count" INTEGER NOT NULL DEFAULT 0,
    "result_json" JSONB,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "ticket_number" TEXT NOT NULL,
    "requester_identifier" TEXT NOT NULL,
    "requester_name" TEXT,
    "requester_email" TEXT,
    "requester_phone" TEXT,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "admin_response" TEXT,
    "assigned_to" TEXT,
    "source" TEXT NOT NULL DEFAULT 'client_portal',
    "notification_status" TEXT NOT NULL DEFAULT 'pending',
    "notification_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "answered_at" TIMESTAMP(3),

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Order_pyme_id_idx" ON "Order"("pyme_id");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_created_at_idx" ON "Order"("created_at");

-- CreateIndex
CREATE INDEX "OrderItem_order_id_idx" ON "OrderItem"("order_id");

-- CreateIndex
CREATE INDEX "OrderItem_product_id_idx" ON "OrderItem"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_external_attempt_id_key" ON "PaymentAttempt"("external_attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_provider_transaction_id_key" ON "PaymentAttempt"("provider_transaction_id");

-- CreateIndex
CREATE INDEX "PaymentAttempt_order_id_idx" ON "PaymentAttempt"("order_id");

-- CreateIndex
CREATE INDEX "PaymentAttempt_status_idx" ON "PaymentAttempt"("status");

-- CreateIndex
CREATE INDEX "PaymentAttempt_created_at_idx" ON "PaymentAttempt"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_external_payment_id_key" ON "Payment"("external_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_billing_document_id_key" ON "Payment"("billing_document_id");

-- CreateIndex
CREATE INDEX "Payment_payment_attempt_id_idx" ON "Payment"("payment_attempt_id");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_billing_status_idx" ON "Payment"("billing_status");

-- CreateIndex
CREATE INDEX "Payment_created_at_idx" ON "Payment"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_payment_attempt_id_key" ON "Payment"("payment_attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "BillingDocument_external_billing_id_key" ON "BillingDocument"("external_billing_id");

-- CreateIndex
CREATE INDEX "BillingDocument_payment_id_idx" ON "BillingDocument"("payment_id");

-- CreateIndex
CREATE INDEX "BillingDocument_provider_idx" ON "BillingDocument"("provider");

-- CreateIndex
CREATE INDEX "BillingDocument_document_type_idx" ON "BillingDocument"("document_type");

-- CreateIndex
CREATE INDEX "BillingDocument_sii_type_idx" ON "BillingDocument"("sii_type");

-- CreateIndex
CREATE INDEX "BillingDocument_status_idx" ON "BillingDocument"("status");

-- CreateIndex
CREATE INDEX "BillingDocument_created_at_idx" ON "BillingDocument"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReversal_external_reversal_id_key" ON "PaymentReversal"("external_reversal_id");

-- CreateIndex
CREATE INDEX "PaymentReversal_external_payment_id_idx" ON "PaymentReversal"("external_payment_id");

-- CreateIndex
CREATE INDEX "PaymentReversal_external_attempt_id_idx" ON "PaymentReversal"("external_attempt_id");

-- CreateIndex
CREATE INDEX "PaymentReversal_payment_id_idx" ON "PaymentReversal"("payment_id");

-- CreateIndex
CREATE INDEX "PaymentReversal_created_at_idx" ON "PaymentReversal"("created_at");

-- CreateIndex
CREATE INDEX "IntegrationLog_system_idx" ON "IntegrationLog"("system");

-- CreateIndex
CREATE INDEX "IntegrationLog_event_type_idx" ON "IntegrationLog"("event_type");

-- CreateIndex
CREATE INDEX "IntegrationLog_direction_idx" ON "IntegrationLog"("direction");

-- CreateIndex
CREATE INDEX "IntegrationLog_status_idx" ON "IntegrationLog"("status");

-- CreateIndex
CREATE INDEX "IntegrationLog_created_at_idx" ON "IntegrationLog"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationOutbox_idempotency_key_key" ON "IntegrationOutbox"("idempotency_key");

-- CreateIndex
CREATE INDEX "IntegrationOutbox_status_next_attempt_at_idx" ON "IntegrationOutbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "IntegrationOutbox_aggregate_type_aggregate_id_idx" ON "IntegrationOutbox"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "IntegrationOutbox_event_type_idx" ON "IntegrationOutbox"("event_type");

-- CreateIndex
CREATE INDEX "IntegrationOutbox_created_at_idx" ON "IntegrationOutbox"("created_at");

-- CreateIndex
CREATE INDEX "DeadLetterQueue_status_idx" ON "DeadLetterQueue"("status");

-- CreateIndex
CREATE INDEX "DeadLetterQueue_source_idx" ON "DeadLetterQueue"("source");

-- CreateIndex
CREATE INDEX "DeadLetterQueue_event_type_idx" ON "DeadLetterQueue"("event_type");

-- CreateIndex
CREATE INDEX "DeadLetterQueue_created_at_idx" ON "DeadLetterQueue"("created_at");

-- CreateIndex
CREATE INDEX "ReconciliationRun_status_idx" ON "ReconciliationRun"("status");

-- CreateIndex
CREATE INDEX "ReconciliationRun_started_at_idx" ON "ReconciliationRun"("started_at");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_ticket_number_key" ON "SupportTicket"("ticket_number");

-- CreateIndex
CREATE INDEX "SupportTicket_requester_identifier_idx" ON "SupportTicket"("requester_identifier");

-- CreateIndex
CREATE INDEX "SupportTicket_requester_email_idx" ON "SupportTicket"("requester_email");

-- CreateIndex
CREATE INDEX "SupportTicket_status_idx" ON "SupportTicket"("status");

-- CreateIndex
CREATE INDEX "SupportTicket_category_idx" ON "SupportTicket"("category");

-- CreateIndex
CREATE INDEX "SupportTicket_created_at_idx" ON "SupportTicket"("created_at");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_payment_attempt_id_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_billing_document_id_fkey" FOREIGN KEY ("billing_document_id") REFERENCES "BillingDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingDocument" ADD CONSTRAINT "BillingDocument_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReversal" ADD CONSTRAINT "PaymentReversal_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
