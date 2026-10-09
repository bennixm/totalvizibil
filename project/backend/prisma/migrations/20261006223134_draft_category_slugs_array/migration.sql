-- AlterTable: add the new array column alongside the old scalar one.
ALTER TABLE "website_drafts" ADD COLUMN "category_slugs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Carry forward every existing single-value pick before dropping the column.
UPDATE "website_drafts"
SET "category_slugs" = ARRAY["category_slug"]
WHERE "category_slug" IS NOT NULL;

-- AlterTable: drop the old scalar column now that its data is preserved above.
ALTER TABLE "website_drafts" DROP COLUMN "category_slug";
