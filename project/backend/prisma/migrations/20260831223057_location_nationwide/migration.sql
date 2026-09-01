-- AlterTable
ALTER TABLE "company_locations" ADD COLUMN     "nationwide" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "website_drafts" ADD COLUMN     "location_nationwide" BOOLEAN NOT NULL DEFAULT false;
