-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "GoogleAdsActionStatus" ADD VALUE 'approved';
ALTER TYPE "GoogleAdsActionStatus" ADD VALUE 'superseded';

-- AlterTable
ALTER TABLE "google_ads_agent_actions" ADD COLUMN     "content_hash" TEXT,
ADD COLUMN     "execution_result" TEXT,
ADD COLUMN     "manual_instructions" TEXT,
ADD COLUMN     "metrics_at_apply" JSONB,
ADD COLUMN     "metrics_observed" JSONB,
ADD COLUMN     "observed_at" TIMESTAMP(3),
ADD COLUMN     "revision_of_id" UUID;
