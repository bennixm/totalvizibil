-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pending_reg_expires_at" TIMESTAMP(3),
ADD COLUMN     "pending_reg_token_hash" TEXT;
