-- AlterTable
ALTER TABLE "wallet_transactions" ADD COLUMN     "spend_day" DATE,
ADD COLUMN     "click_count" INTEGER;

-- CreateIndex
-- NULLs are distinct in a Postgres unique index, so every existing row
-- (spend_day/company_id/provider all NULL for anything that isn't a rolled-up
-- CPC row) is unaffected — this only constrains one row per
-- (wallet, company, provider, day) going forward.
CREATE UNIQUE INDEX "wallet_transactions_wallet_id_company_id_provider_spend_d_key" ON "wallet_transactions"("wallet_id", "company_id", "provider", "spend_day");
