-- CreateEnum
CREATE TYPE "GoogleAdsConnectionStatus" AS ENUM ('pending', 'connected', 'revoked', 'error');

-- CreateEnum
CREATE TYPE "GoogleAdsUserCampaignStatus" AS ENUM ('active', 'paused', 'disconnected');

-- CreateEnum
CREATE TYPE "GoogleAdsCycleStatus" AS ENUM ('running', 'completed', 'failed');

-- AlterTable
ALTER TABLE "google_ads_agent_events" ADD COLUMN     "user_campaign_id" UUID;

-- CreateTable
CREATE TABLE "google_ads_connections" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "draft_token_hash" TEXT,
    "oauth_state_hash" TEXT,
    "oauth_state_expires_at" TIMESTAMP(3),
    "google_email" TEXT,
    "refresh_token_enc" TEXT,
    "status" "GoogleAdsConnectionStatus" NOT NULL DEFAULT 'pending',
    "last_error" TEXT,
    "connected_at" TIMESTAMP(3),
    "selected_customer_id" TEXT,
    "selected_login_customer_id" TEXT,
    "selected_campaign_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_ads_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_ads_user_campaigns" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "customer_id" TEXT NOT NULL,
    "login_customer_id" TEXT,
    "customer_name" TEXT,
    "google_campaign_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel_type" TEXT,
    "currency_code" TEXT,
    "status" "GoogleAdsUserCampaignStatus" NOT NULL DEFAULT 'active',
    "settings" JSONB,
    "snapshot" JSONB,
    "score" INTEGER,
    "ad_strength" TEXT,
    "synced_at" TIMESTAMP(3),
    "last_cycle_at" TIMESTAMP(3),
    "next_cycle_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_ads_user_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_ads_optimization_cycles" (
    "id" UUID NOT NULL,
    "user_campaign_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "GoogleAdsCycleStatus" NOT NULL DEFAULT 'running',
    "idempotency_key" TEXT,
    "quote" JSONB NOT NULL,
    "quoted_minor" INTEGER NOT NULL,
    "charged_minor" INTEGER NOT NULL DEFAULT 0,
    "refunded_minor" INTEGER NOT NULL DEFAULT 0,
    "charge_txn_id" UUID,
    "refund_txn_id" UUID,
    "settlement" JSONB,
    "complexity_level" TEXT,
    "complexity_points" DOUBLE PRECISION,
    "tasks_planned" INTEGER NOT NULL DEFAULT 0,
    "tasks_applied" INTEGER NOT NULL DEFAULT 0,
    "tasks_proposed" INTEGER NOT NULL DEFAULT 0,
    "elements_analyzed" INTEGER NOT NULL DEFAULT 0,
    "ai_cost_minor" INTEGER NOT NULL DEFAULT 0,
    "ai_call_count" INTEGER NOT NULL DEFAULT 0,
    "ai_model" TEXT,
    "score_before" INTEGER,
    "score_after" INTEGER,
    "summary" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "google_ads_optimization_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_ads_user_actions" (
    "id" UUID NOT NULL,
    "user_campaign_id" UUID NOT NULL,
    "cycle_id" UUID,
    "action" TEXT NOT NULL,
    "status" "GoogleAdsActionStatus" NOT NULL DEFAULT 'applied',
    "before" JSONB,
    "after" JSONB,
    "reasoning" TEXT,
    "google_campaign_id" TEXT,
    "required_approval" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "error_message" TEXT,
    "execution_result" TEXT,
    "content_hash" TEXT,
    "metrics_at_apply" JSONB,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "google_ads_user_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_ads_connections_draft_token_hash_key" ON "google_ads_connections"("draft_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "google_ads_connections_oauth_state_hash_key" ON "google_ads_connections"("oauth_state_hash");

-- CreateIndex
CREATE INDEX "google_ads_connections_user_id_idx" ON "google_ads_connections"("user_id");

-- CreateIndex
CREATE INDEX "google_ads_user_campaigns_status_next_cycle_at_idx" ON "google_ads_user_campaigns"("status", "next_cycle_at");

-- CreateIndex
CREATE UNIQUE INDEX "google_ads_user_campaigns_user_id_customer_id_google_campai_key" ON "google_ads_user_campaigns"("user_id", "customer_id", "google_campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "google_ads_optimization_cycles_idempotency_key_key" ON "google_ads_optimization_cycles"("idempotency_key");

-- CreateIndex
CREATE INDEX "google_ads_optimization_cycles_user_campaign_id_started_at_idx" ON "google_ads_optimization_cycles"("user_campaign_id", "started_at");

-- CreateIndex
CREATE INDEX "google_ads_optimization_cycles_user_id_started_at_idx" ON "google_ads_optimization_cycles"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "google_ads_optimization_cycles_started_at_idx" ON "google_ads_optimization_cycles"("started_at");

-- CreateIndex
CREATE INDEX "google_ads_user_actions_user_campaign_id_created_at_idx" ON "google_ads_user_actions"("user_campaign_id", "created_at");

-- CreateIndex
CREATE INDEX "google_ads_user_actions_google_campaign_id_status_idx" ON "google_ads_user_actions"("google_campaign_id", "status");

-- CreateIndex
CREATE INDEX "google_ads_agent_events_user_campaign_id_started_at_idx" ON "google_ads_agent_events"("user_campaign_id", "started_at");

-- AddForeignKey
ALTER TABLE "google_ads_connections" ADD CONSTRAINT "google_ads_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_ads_user_campaigns" ADD CONSTRAINT "google_ads_user_campaigns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_ads_user_campaigns" ADD CONSTRAINT "google_ads_user_campaigns_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "google_ads_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_ads_optimization_cycles" ADD CONSTRAINT "google_ads_optimization_cycles_user_campaign_id_fkey" FOREIGN KEY ("user_campaign_id") REFERENCES "google_ads_user_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_ads_optimization_cycles" ADD CONSTRAINT "google_ads_optimization_cycles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_ads_user_actions" ADD CONSTRAINT "google_ads_user_actions_user_campaign_id_fkey" FOREIGN KEY ("user_campaign_id") REFERENCES "google_ads_user_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_ads_user_actions" ADD CONSTRAINT "google_ads_user_actions_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "google_ads_optimization_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
