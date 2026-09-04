-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "void_reason" TEXT,
ADD COLUMN     "voided_at" TIMESTAMP(3);
