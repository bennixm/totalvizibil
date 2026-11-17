-- AlterTable
ALTER TABLE "feed_search_daily" ADD COLUMN     "ai_cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "ai_input_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ai_output_tokens" INTEGER NOT NULL DEFAULT 0;
