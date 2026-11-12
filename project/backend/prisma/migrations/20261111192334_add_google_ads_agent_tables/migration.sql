-- CreateEnum
CREATE TYPE "GoogleAdsCampaignStatus" AS ENUM ('pending_creation', 'active', 'paused');

-- CreateEnum
CREATE TYPE "GoogleAdsActionStatus" AS ENUM ('applied', 'pending_approval', 'rejected');

-- CreateEnum
CREATE TYPE "GoogleAdsAgentRunKind" AS ENUM ('structural', 'intelligence');

-- CreateEnum
CREATE TYPE "GoogleAdsAgentRunStatus" AS ENUM ('in_progress', 'success', 'partial', 'failed');

-- CreateTable
CREATE TABLE "google_ads_subcategory_campaigns" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "google_campaign_id" TEXT,
    "google_ad_group_id" TEXT,
    "google_budget_resource_id" TEXT,
    "status" "GoogleAdsCampaignStatus" NOT NULL DEFAULT 'pending_creation',
    "daily_budget_minor" INTEGER NOT NULL DEFAULT 0,
    "max_cpc_minor" INTEGER NOT NULL DEFAULT 0,
    "last_structural_check_at" TIMESTAMP(3),
    "last_intelligence_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_ads_subcategory_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_ads_agent_actions" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "status" "GoogleAdsActionStatus" NOT NULL DEFAULT 'applied',
    "before" JSONB,
    "after" JSONB,
    "reasoning" TEXT,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "google_ads_agent_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_ads_agent_runs" (
    "id" UUID NOT NULL,
    "kind" "GoogleAdsAgentRunKind" NOT NULL,
    "status" "GoogleAdsAgentRunStatus" NOT NULL DEFAULT 'in_progress',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "categories_scanned" INTEGER NOT NULL DEFAULT 0,
    "actions_taken" INTEGER NOT NULL DEFAULT 0,
    "actions_pending_approval" INTEGER NOT NULL DEFAULT 0,
    "claude_cost_estimate_minor" INTEGER,
    "error_summary" TEXT,

    CONSTRAINT "google_ads_agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_ads_subcategory_campaigns_category_id_key" ON "google_ads_subcategory_campaigns"("category_id");

-- CreateIndex
CREATE INDEX "google_ads_subcategory_campaigns_status_idx" ON "google_ads_subcategory_campaigns"("status");

-- CreateIndex
CREATE INDEX "google_ads_agent_actions_category_id_created_at_idx" ON "google_ads_agent_actions"("category_id", "created_at");

-- CreateIndex
CREATE INDEX "google_ads_agent_actions_status_idx" ON "google_ads_agent_actions"("status");

-- CreateIndex
CREATE INDEX "google_ads_agent_runs_kind_status_idx" ON "google_ads_agent_runs"("kind", "status");

-- AddForeignKey
ALTER TABLE "google_ads_subcategory_campaigns" ADD CONSTRAINT "google_ads_subcategory_campaigns_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_ads_agent_actions" ADD CONSTRAINT "google_ads_agent_actions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_ads_agent_actions" ADD CONSTRAINT "google_ads_agent_actions_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
