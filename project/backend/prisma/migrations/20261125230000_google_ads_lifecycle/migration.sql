ALTER TYPE "GoogleAdsUserCampaignStatus" ADD VALUE 'removed';
ALTER TYPE "GoogleAdsActionStatus" ADD VALUE 'expired';
ALTER TABLE "google_ads_connections" ADD COLUMN "google_sub" TEXT;
