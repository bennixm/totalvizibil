-- CreateEnum
CREATE TYPE "ExternalInvoiceProcessing" AS ENUM ('needs_review', 'verified');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ExternalInvoiceSource" ADD VALUE 'email';
ALTER TYPE "ExternalInvoiceSource" ADD VALUE 'efactura';
ALTER TYPE "ExternalInvoiceSource" ADD VALUE 'peppol';

-- AlterTable
ALTER TABLE "external_invoices" ADD COLUMN     "extraction" JSONB,
ADD COLUMN     "lines" JSONB,
ADD COLUMN     "paid_at" DATE,
ADD COLUMN     "possible_duplicate_of_id" UUID,
ADD COLUMN     "processing_status" "ExternalInvoiceProcessing" NOT NULL DEFAULT 'verified',
ADD COLUMN     "supplier_vat_id" TEXT,
ADD COLUMN     "vat_lines" JSONB;

-- CreateTable
CREATE TABLE "external_invoice_events" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "actor_id" UUID,
    "kind" TEXT NOT NULL,
    "message" TEXT,
    "changes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_invoice_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_invoice_attachments" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_invoice_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_invoice_events_invoice_id_created_at_idx" ON "external_invoice_events"("invoice_id", "created_at");

-- CreateIndex
CREATE INDEX "external_invoice_events_kind_idx" ON "external_invoice_events"("kind");

-- CreateIndex
CREATE INDEX "external_invoice_attachments_invoice_id_idx" ON "external_invoice_attachments"("invoice_id");

-- CreateIndex
CREATE INDEX "external_invoices_processing_status_idx" ON "external_invoices"("processing_status");

-- CreateIndex
CREATE INDEX "external_invoices_payment_status_due_date_idx" ON "external_invoices"("payment_status", "due_date");

-- AddForeignKey
ALTER TABLE "external_invoice_events" ADD CONSTRAINT "external_invoice_events_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "external_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_invoice_events" ADD CONSTRAINT "external_invoice_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_invoice_attachments" ADD CONSTRAINT "external_invoice_attachments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "external_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_invoice_attachments" ADD CONSTRAINT "external_invoice_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
