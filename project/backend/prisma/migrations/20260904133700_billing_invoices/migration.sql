-- CreateEnum
CREATE TYPE "BillingProfileKind" AS ENUM ('individual', 'company');

-- CreateTable
CREATE TABLE "billing_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "BillingProfileKind" NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "reg_com" TEXT,
    "vat_payer" BOOLEAN NOT NULL DEFAULT false,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "county" TEXT,
    "postal_code" TEXT,
    "country" TEXT NOT NULL DEFAULT 'RO',
    "billing_email" TEXT,
    "iban" TEXT,
    "bank_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_counters" (
    "series" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "next_seq" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("series")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "wallet_transaction_id" UUID NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "buyer_kind" "BillingProfileKind" NOT NULL,
    "buyer_name" TEXT NOT NULL,
    "buyer_tax_id" TEXT,
    "buyer_reg_com" TEXT,
    "buyer_vat_payer" BOOLEAN NOT NULL,
    "buyer_address" TEXT NOT NULL,
    "buyer_city" TEXT NOT NULL,
    "buyer_county" TEXT,
    "buyer_postal_code" TEXT,
    "buyer_country" TEXT NOT NULL,
    "buyer_email" TEXT,
    "issuer_name" TEXT NOT NULL,
    "issuer_tax_id" TEXT,
    "issuer_reg_com" TEXT,
    "issuer_address" TEXT NOT NULL,
    "issuer_iban" TEXT,
    "issuer_bank" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "description" TEXT NOT NULL,
    "subtotal_minor" INTEGER NOT NULL,
    "vat_rate_pct" INTEGER NOT NULL,
    "vat_minor" INTEGER NOT NULL,
    "total_minor" INTEGER NOT NULL,
    "eur_cents" INTEGER,
    "fx_rate" DECIMAL(10,4),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_profiles_user_id_key" ON "billing_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_wallet_transaction_id_key" ON "invoices"("wallet_transaction_id");

-- CreateIndex
CREATE INDEX "invoices_user_id_issued_at_idx" ON "invoices"("user_id", "issued_at");

-- AddForeignKey
ALTER TABLE "billing_profiles" ADD CONSTRAINT "billing_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_wallet_transaction_id_fkey" FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
