-- AlterTable
ALTER TABLE "external_invoices" ADD COLUMN     "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "supplier_id" UUID;

-- CreateTable
CREATE TABLE "external_suppliers" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "vat_id" TEXT,
    "email" TEXT,
    "payment_terms_days" INTEGER,
    "default_currency" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_vat_confirmations" (
    "id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "confirmed_vat_minor" INTEGER NOT NULL,
    "note" TEXT,
    "confirmed_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_vat_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_suppliers_vat_id_idx" ON "external_suppliers"("vat_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_suppliers_provider_name_key_key" ON "external_suppliers"("provider", "name_key");

-- CreateIndex
CREATE UNIQUE INDEX "external_vat_confirmations_period_currency_key" ON "external_vat_confirmations"("period", "currency");

-- AddForeignKey
ALTER TABLE "external_invoices" ADD CONSTRAINT "external_invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "external_suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_vat_confirmations" ADD CONSTRAINT "external_vat_confirmations_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
