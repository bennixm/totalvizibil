-- AlterTable
ALTER TABLE "website_drafts" ADD COLUMN     "location_city" TEXT,
ADD COLUMN     "location_country" TEXT,
ADD COLUMN     "location_lat" DOUBLE PRECISION,
ADD COLUMN     "location_lng" DOUBLE PRECISION,
ADD COLUMN     "location_radius_km" INTEGER,
ADD COLUMN     "location_region" TEXT;
