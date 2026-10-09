-- Service area moves from city + radius to județ (Romanian county) + nationwide.

-- company_locations: region -> county (carries existing values forward), drop radius.
ALTER TABLE "company_locations" ADD COLUMN "county" TEXT;
UPDATE "company_locations" SET "county" = "region" WHERE "region" IS NOT NULL;
ALTER TABLE "company_locations" DROP COLUMN "region";
ALTER TABLE "company_locations" DROP COLUMN "service_radius_km";

-- website_drafts: location_region -> location_county, drop location_radius_km.
ALTER TABLE "website_drafts" ADD COLUMN "location_county" TEXT;
UPDATE "website_drafts" SET "location_county" = "location_region" WHERE "location_region" IS NOT NULL;
ALTER TABLE "website_drafts" DROP COLUMN "location_region";
ALTER TABLE "website_drafts" DROP COLUMN "location_radius_km";
