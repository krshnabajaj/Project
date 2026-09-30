-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'ENGINEER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PO_RECEIVED', 'PO_UNDER_REVIEW', 'ORDER_CREATED', 'ASSIGNED', 'ACCEPTED', 'ASSEMBLY_IN_PROGRESS', 'TESTING', 'COMPLETED', 'PHOTOS_UPLOADED', 'PACKED', 'READY_FOR_DISPATCH', 'DISPATCHED', 'CLOSED', 'ON_HOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('GMAIL', 'MANUAL');

-- CreateEnum
CREATE TYPE "StagePhase" AS ENUM ('ASSEMBLY', 'TESTING', 'FINAL');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED', 'MANUAL');

-- CreateEnum
CREATE TYPE "DuplicateStatus" AS ENUM ('NONE', 'SUSPECTED', 'IGNORED', 'MERGED', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('PO_ATTACHMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ImageKind" AS ENUM ('MACHINE', 'PROGRESS');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "GmailConnectionStatus" AS ENUM ('CONNECTED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "GmailMessageResult" AS ENUM ('IMPORTED', 'SKIPPED', 'DUPLICATE', 'ERROR');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "billing_address" TEXT,
    "shipping_address" TEXT,
    "contact_person" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "email_domain" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_sequences" (
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_sequences_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT,
    "source" "OrderSource" NOT NULL DEFAULT 'MANUAL',
    "customer_id" TEXT,
    "po_number" TEXT,
    "po_date" DATE,
    "delivery_date" DATE,
    "payment_terms" TEXT,
    "reference_number" TEXT,
    "machine_name" TEXT,
    "machine_model" TEXT,
    "quantity" INTEGER,
    "specifications" TEXT,
    "special_instructions" TEXT,
    "unit_price" DECIMAL(14,2),
    "total_value" DECIMAL(14,2),
    "tax" DECIMAL(14,2),
    "currency" TEXT,
    "engineer_id" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PO_RECEIVED',
    "status_before_hold" "OrderStatus",
    "hold_reason" TEXT,
    "cancel_reason" TEXT,
    "current_stage_id" TEXT,
    "progress_percentage" INTEGER NOT NULL DEFAULT 0,
    "expected_completion_date" DATE,
    "approved_at" TIMESTAMP(3),
    "assigned_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "completion_remarks" TEXT,
    "photos_submitted_at" TIMESTAMP(3),
    "last_update_at" TIMESTAMP(3),
    "last_overdue_alert_on" DATE,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "source" "OrderSource" NOT NULL DEFAULT 'GMAIL',
    "gmail_message_id" TEXT,
    "gmail_thread_id" TEXT,
    "sender" TEXT,
    "sender_email" TEXT,
    "subject" TEXT,
    "received_at" TIMESTAMP(3),
    "body_text" TEXT,
    "extracted_data" JSONB,
    "extraction_status" "ExtractionStatus" NOT NULL DEFAULT 'MANUAL',
    "extraction_warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "duplicate_status" "DuplicateStatus" NOT NULL DEFAULT 'NONE',
    "duplicate_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "duplicate_of_order_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "purchase_order_id" TEXT,
    "kind" "DocumentKind" NOT NULL DEFAULT 'OTHER',
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assembly_stages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "phase" "StagePhase" NOT NULL DEFAULT 'ASSEMBLY',
    "default_progress" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assembly_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_stage_progress" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "stage_id" TEXT NOT NULL,
    "status" "StageStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "notes" TEXT,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_stage_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_updates" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "engineer_id" TEXT NOT NULL,
    "update_date" DATE NOT NULL,
    "stage_id" TEXT NOT NULL,
    "previous_stage_id" TEXT,
    "progress" INTEGER NOT NULL,
    "work_completed" TEXT NOT NULL,
    "issues" TEXT,
    "expected_delay_days" INTEGER,
    "material_required" TEXT,
    "next_step" TEXT,
    "expected_completion" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_images" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "daily_update_id" TEXT,
    "kind" "ImageKind" NOT NULL DEFAULT 'MACHINE',
    "uploaded_by" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "order_id" TEXT,
    "type" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "provider_message_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "in_app_notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "order_id" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "in_app_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "user_name" TEXT,
    "user_role" TEXT,
    "action" TEXT NOT NULL,
    "order_id" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "summary" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_notes" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "packed_at" TIMESTAMP(3),
    "packed_by" TEXT,
    "packed_by_name" TEXT,
    "packing_remarks" TEXT,
    "package_count" INTEGER,
    "package_dimensions" TEXT,
    "weight_kg" DECIMAL(10,2),
    "ready_at" TIMESTAMP(3),
    "ready_by" TEXT,
    "dispatched_at" TIMESTAMP(3),
    "dispatched_by" TEXT,
    "courier" TEXT,
    "transporter" TEXT,
    "tracking_number" TEXT,
    "vehicle_number" TEXT,
    "dispatch_remarks" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "gmail_connections" (
    "id" TEXT NOT NULL DEFAULT 'primary',
    "email" TEXT NOT NULL,
    "encrypted_refresh_token" TEXT NOT NULL,
    "encrypted_access_token" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "scopes" TEXT,
    "history_id" TEXT,
    "watch_expiration" TIMESTAMP(3),
    "status" "GmailConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "last_error" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "connected_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gmail_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gmail_processed_messages" (
    "message_id" TEXT NOT NULL,
    "thread_id" TEXT,
    "result" "GmailMessageResult" NOT NULL,
    "reason" TEXT,
    "purchase_order_id" TEXT,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gmail_processed_messages_pkey" PRIMARY KEY ("message_id")
);

-- CreateTable
CREATE TABLE "system_logs" (
    "id" TEXT NOT NULL,
    "level" "LogLevel" NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_active_idx" ON "users"("role", "active");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE INDEX "customers_email_domain_idx" ON "customers"("email_domain");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_engineer_id_status_idx" ON "orders"("engineer_id", "status");

-- CreateIndex
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");

-- CreateIndex
CREATE INDEX "orders_po_number_idx" ON "orders"("po_number");

-- CreateIndex
CREATE INDEX "orders_expected_completion_date_idx" ON "orders"("expected_completion_date");

-- CreateIndex
CREATE INDEX "orders_last_update_at_idx" ON "orders"("last_update_at");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_gmail_message_id_key" ON "purchase_orders"("gmail_message_id");

-- CreateIndex
CREATE INDEX "purchase_orders_order_id_idx" ON "purchase_orders"("order_id");

-- CreateIndex
CREATE INDEX "purchase_orders_sender_email_idx" ON "purchase_orders"("sender_email");

-- CreateIndex
CREATE INDEX "purchase_orders_duplicate_status_idx" ON "purchase_orders"("duplicate_status");

-- CreateIndex
CREATE INDEX "documents_order_id_idx" ON "documents"("order_id");

-- CreateIndex
CREATE INDEX "documents_sha256_idx" ON "documents"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "assembly_stages_name_key" ON "assembly_stages"("name");

-- CreateIndex
CREATE INDEX "assembly_stages_active_sequence_idx" ON "assembly_stages"("active", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "order_stage_progress_order_id_stage_id_key" ON "order_stage_progress"("order_id", "stage_id");

-- CreateIndex
CREATE INDEX "daily_updates_order_id_created_at_idx" ON "daily_updates"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "daily_updates_engineer_id_update_date_idx" ON "daily_updates"("engineer_id", "update_date");

-- CreateIndex
CREATE INDEX "order_images_order_id_kind_idx" ON "order_images"("order_id", "kind");

-- CreateIndex
CREATE INDEX "notifications_status_channel_idx" ON "notifications"("status", "channel");

-- CreateIndex
CREATE INDEX "notifications_order_id_idx" ON "notifications"("order_id");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE INDEX "in_app_notifications_user_id_read_at_idx" ON "in_app_notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "in_app_notifications_created_at_idx" ON "in_app_notifications"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_order_id_created_at_idx" ON "audit_logs"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "order_notes_order_id_created_at_idx" ON "order_notes"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "dispatch_order_id_key" ON "dispatch"("order_id");

-- CreateIndex
CREATE INDEX "gmail_processed_messages_processed_at_idx" ON "gmail_processed_messages"("processed_at");

-- CreateIndex
CREATE INDEX "system_logs_level_created_at_idx" ON "system_logs"("level", "created_at");

-- CreateIndex
CREATE INDEX "system_logs_source_created_at_idx" ON "system_logs"("source", "created_at");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_current_stage_id_fkey" FOREIGN KEY ("current_stage_id") REFERENCES "assembly_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_duplicate_of_order_id_fkey" FOREIGN KEY ("duplicate_of_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_stage_progress" ADD CONSTRAINT "order_stage_progress_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_stage_progress" ADD CONSTRAINT "order_stage_progress_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "assembly_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_stage_progress" ADD CONSTRAINT "order_stage_progress_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_updates" ADD CONSTRAINT "daily_updates_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_updates" ADD CONSTRAINT "daily_updates_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_updates" ADD CONSTRAINT "daily_updates_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "assembly_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_images" ADD CONSTRAINT "order_images_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_images" ADD CONSTRAINT "order_images_daily_update_id_fkey" FOREIGN KEY ("daily_update_id") REFERENCES "daily_updates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_images" ADD CONSTRAINT "order_images_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch" ADD CONSTRAINT "dispatch_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch" ADD CONSTRAINT "dispatch_packed_by_fkey" FOREIGN KEY ("packed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch" ADD CONSTRAINT "dispatch_ready_by_fkey" FOREIGN KEY ("ready_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch" ADD CONSTRAINT "dispatch_dispatched_by_fkey" FOREIGN KEY ("dispatched_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
