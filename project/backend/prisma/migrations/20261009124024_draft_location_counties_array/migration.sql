-- A draft's service area becomes a SET of județe (multi-select), mirroring
-- the business-creation flow's new multi-county support.

ALTER TABLE "website_drafts" ADD COLUMN "location_counties" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Carry forward every existing single-value pick before dropping the column.
UPDATE "website_drafts"
SET "location_counties" = ARRAY["location_county"]
WHERE "location_county" IS NOT NULL;

ALTER TABLE "website_drafts" DROP COLUMN "location_county";
