-- CreateEnum
CREATE TYPE "ExternalInvoiceSource" AS ENUM ('api', 'manual');

-- CreateTable
CREATE TABLE "external_invoices" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_name" TEXT,
    "source" "ExternalInvoiceSource" NOT NULL,
    "external_id" TEXT,
    "invoice_number" TEXT,
    "doc_type" TEXT,
    "issue_date" DATE NOT NULL,
    "due_date" DATE,
    "period_start" DATE,
    "period_end" DATE,
    "currency" TEXT NOT NULL,
    "subtotal_minor" INTEGER,
    "tax_minor" INTEGER,
    "total_minor" INTEGER NOT NULL,
    "payment_status" TEXT,
    "document_error" TEXT,
    "note" TEXT,
    "raw" JSONB,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_invoice_documents" (
    "invoice_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_invoice_documents_pkey" PRIMARY KEY ("invoice_id")
);

-- CreateTable
CREATE TABLE "external_invoice_syncs" (
    "provider" TEXT NOT NULL,
    "last_run_at" TIMESTAMP(3) NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "message" TEXT,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "documents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "external_invoice_syncs_pkey" PRIMARY KEY ("provider")
);

-- CreateIndex
CREATE INDEX "external_invoices_issue_date_idx" ON "external_invoices"("issue_date");

-- CreateIndex
CREATE INDEX "external_invoices_provider_issue_date_idx" ON "external_invoices"("provider", "issue_date");

-- CreateIndex
CREATE UNIQUE INDEX "external_invoices_provider_external_id_key" ON "external_invoices"("provider", "external_id");

-- AddForeignKey
ALTER TABLE "external_invoices" ADD CONSTRAINT "external_invoices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_invoice_documents" ADD CONSTRAINT "external_invoice_documents_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "external_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
