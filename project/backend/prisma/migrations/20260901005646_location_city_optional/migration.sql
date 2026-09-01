-- Whole-country coverage has no fixed city; allow NULL.
ALTER TABLE "company_locations" ALTER COLUMN "city" DROP NOT NULL;
