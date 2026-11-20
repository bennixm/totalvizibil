-- CreateEnum
CREATE TYPE "GoogleAdsAgentEventStatus" AS ENUM ('running', 'completed', 'failed', 'waiting_approval', 'skipped');

-- AlterEnum
ALTER TYPE "GoogleAdsActionStatus" ADD VALUE 'failed';

-- AlterEnum
ALTER TYPE "GoogleAdsAgentRunKind" ADD VALUE 'monitor';

-- AlterTable
ALTER TABLE "google_ads_agent_actions" ADD COLUMN     "error_message" TEXT,
ADD COLUMN     "google_campaign_id" TEXT,
ADD COLUMN     "required_approval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verified_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "google_ads_campaign_snapshots" (
    "id" UUID NOT NULL,
    "google_campaign_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "primary_status" TEXT,
    "primary_status_reasons" TEXT[],
    "bidding_strategy_type" TEXT,
    "managed" BOOLEAN NOT NULL DEFAULT false,
    "category_id" UUID,
    "currency_code" TEXT,
    "daily_budget_micros" TEXT,
    "metrics" JSONB NOT NULL,
    "ad_strength" TEXT,
    "score" INTEGER,
    "score_breakdown" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "assets" JSONB NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "last_optimized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_ads_campaign_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_ads_agent_events" (
    "id" UUID NOT NULL,
    "run_id" UUID,
    "google_campaign_id" TEXT,
    "campaign_name" TEXT,
    "step" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "GoogleAdsAgentEventStatus" NOT NULL,
    "result" TEXT,
    "details" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "google_ads_agent_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_ads_campaign_snapshots_google_campaign_id_key" ON "google_ads_campaign_snapshots"("google_campaign_id");

-- CreateIndex
CREATE INDEX "google_ads_agent_events_started_at_idx" ON "google_ads_agent_events"("started_at");

-- CreateIndex
CREATE INDEX "google_ads_agent_events_run_id_idx" ON "google_ads_agent_events"("run_id");

-- CreateIndex
CREATE INDEX "google_ads_agent_events_google_campaign_id_started_at_idx" ON "google_ads_agent_events"("google_campaign_id", "started_at");

-- Backfill: every action that ever sat in the approval queue (still pending,
-- approved, or rejected) required an admin decision.
UPDATE "google_ads_agent_actions"
SET "required_approval" = true
WHERE "status" IN ('pending_approval', 'rejected') OR "approved_by_user_id" IS NOT NULL;
