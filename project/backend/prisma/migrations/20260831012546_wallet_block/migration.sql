-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "blocked_at" TIMESTAMP(3),
ADD COLUMN     "blocked_reason" TEXT;
