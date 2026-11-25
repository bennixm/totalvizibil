-- CreateEnum
CREATE TYPE "GoogleAdsChatTurnStatus" AS ENUM ('running', 'completed', 'failed');

-- AlterTable
ALTER TABLE "google_ads_user_actions" ADD COLUMN     "chat_turn_id" UUID;

-- AlterTable
ALTER TABLE "google_ads_user_campaigns" ADD COLUMN     "brief" JSONB;

-- CreateTable
CREATE TABLE "google_ads_chat_turns" (
    "id" UUID NOT NULL,
    "user_campaign_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "GoogleAdsChatTurnStatus" NOT NULL DEFAULT 'running',
    "idempotency_key" TEXT NOT NULL,
    "user_text" TEXT NOT NULL,
    "assistant_text" TEXT,
    "questions" JSONB,
    "held_minor" INTEGER NOT NULL,
    "charged_minor" INTEGER NOT NULL DEFAULT 0,
    "charge_txn_id" UUID,
    "pricing" JSONB,
    "ai_cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ai_call_count" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "ai_model" TEXT,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "google_ads_chat_turns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_ads_chat_turns_idempotency_key_key" ON "google_ads_chat_turns"("idempotency_key");

-- CreateIndex
CREATE INDEX "google_ads_chat_turns_user_campaign_id_created_at_idx" ON "google_ads_chat_turns"("user_campaign_id", "created_at");

-- CreateIndex
CREATE INDEX "google_ads_chat_turns_created_at_idx" ON "google_ads_chat_turns"("created_at");

-- CreateIndex
CREATE INDEX "google_ads_user_actions_chat_turn_id_idx" ON "google_ads_user_actions"("chat_turn_id");

-- AddForeignKey
ALTER TABLE "google_ads_user_actions" ADD CONSTRAINT "google_ads_user_actions_chat_turn_id_fkey" FOREIGN KEY ("chat_turn_id") REFERENCES "google_ads_chat_turns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_ads_chat_turns" ADD CONSTRAINT "google_ads_chat_turns_user_campaign_id_fkey" FOREIGN KEY ("user_campaign_id") REFERENCES "google_ads_user_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_ads_chat_turns" ADD CONSTRAINT "google_ads_chat_turns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

