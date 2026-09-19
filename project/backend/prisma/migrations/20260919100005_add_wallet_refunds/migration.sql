-- AlterTable
ALTER TABLE "wallet_transactions" ADD COLUMN     "fee_minor" INTEGER,
ADD COLUMN     "fee_pct" INTEGER,
ADD COLUMN     "initiated_by_admin_id" UUID,
ADD COLUMN     "process_at" TIMESTAMP(3),
ADD COLUMN     "refund_of_id" UUID;

-- CreateIndex
CREATE INDEX "wallet_transactions_refund_of_id_idx" ON "wallet_transactions"("refund_of_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_status_process_at_idx" ON "wallet_transactions"("status", "process_at");

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_refund_of_id_fkey" FOREIGN KEY ("refund_of_id") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
