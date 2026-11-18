-- AlterTable
ALTER TABLE "platform_expenses" ADD COLUMN     "eur_amount_minor" INTEGER,
ADD COLUMN     "fx_rate" DECIMAL(12,6);
