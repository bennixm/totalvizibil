-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'active', 'paused', 'depleted');

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "daily_budget_minor" INTEGER NOT NULL,
    "cpc_minor" INTEGER NOT NULL,
    "appear_first" BOOLEAN NOT NULL DEFAULT false,
    "spent_today_minor" INTEGER NOT NULL DEFAULT 0,
    "activated_at" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_company_id_key" ON "campaigns"("company_id");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
