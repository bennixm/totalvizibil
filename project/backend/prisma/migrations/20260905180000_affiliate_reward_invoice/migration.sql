-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('topup', 'affiliate_reward');

-- AlterTable: every existing invoice is a top-up.
ALTER TABLE "invoices" ADD COLUMN "kind" "InvoiceKind" NOT NULL DEFAULT 'topup';

-- AlterTable: link a referral to the reward invoice issued for it.
ALTER TABLE "referrals" ADD COLUMN "reward_invoice_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "referrals_reward_invoice_id_key" ON "referrals"("reward_invoice_id");

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_reward_invoice_id_fkey" FOREIGN KEY ("reward_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
