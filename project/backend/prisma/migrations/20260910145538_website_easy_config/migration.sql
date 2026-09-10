-- AlterTable
ALTER TABLE "websites" ADD COLUMN     "easy_config" JSONB;

-- RenameIndex
ALTER INDEX "wallet_transactions_wallet_id_company_id_provider_spend_d_key" RENAME TO "wallet_transactions_wallet_id_company_id_provider_spend_day_key";
