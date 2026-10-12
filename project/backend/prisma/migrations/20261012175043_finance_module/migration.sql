-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('hosting', 'call_center', 'cloud_storage', 'domains', 'google_ads', 'stripe_fees', 'other');

-- CreateEnum
CREATE TYPE "ExpenseSource" AS ENUM ('manual', 'stripe_api');

-- CreateTable
CREATE TABLE "platform_expenses" (
    "id" UUID NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "incurred_on" DATE NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "source" "ExpenseSource" NOT NULL DEFAULT 'manual',
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_expenses_category_incurred_on_idx" ON "platform_expenses"("category", "incurred_on");

-- AddForeignKey
ALTER TABLE "platform_expenses" ADD CONSTRAINT "platform_expenses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
