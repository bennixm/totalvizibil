-- AlterTable
ALTER TABLE "google_ads_agent_runs" ADD COLUMN     "claude_call_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "claude_input_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "claude_model" TEXT,
ADD COLUMN     "claude_output_tokens" INTEGER NOT NULL DEFAULT 0;
