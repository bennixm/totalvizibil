/*
  Warnings:

  - You are about to drop the column `refund_of_id` on the `wallet_transactions` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "wallet_transactions" DROP CONSTRAINT "wallet_transactions_refund_of_id_fkey";

-- DropIndex
DROP INDEX "wallet_transactions_refund_of_id_idx";

-- AlterTable
ALTER TABLE "wallet_transactions" DROP COLUMN "refund_of_id",
ADD COLUMN     "refund_reserved_minor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refund_sources" JSONB;
