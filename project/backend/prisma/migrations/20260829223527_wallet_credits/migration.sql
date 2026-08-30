-- CreateEnum
CREATE TYPE "WalletTxnType" AS ENUM ('purchase', 'spend', 'refund', 'adjustment');

-- CreateEnum
CREATE TYPE "WalletTxnStatus" AS ENUM ('pending', 'completed', 'failed', 'canceled');

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "balance_minor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "type" "WalletTxnType" NOT NULL,
    "status" "WalletTxnStatus" NOT NULL DEFAULT 'completed',
    "amount_minor" INTEGER NOT NULL,
    "balance_after_minor" INTEGER,
    "eur_cents" INTEGER,
    "ron_bani" INTEGER,
    "fx_rate" DECIMAL(10,4),
    "provider" TEXT,
    "provider_ref" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_company_id_key" ON "wallets"("company_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_wallet_id_created_at_idx" ON "wallet_transactions"("wallet_id", "created_at");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
