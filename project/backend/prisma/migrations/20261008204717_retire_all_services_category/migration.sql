-- Retire the synthetic "Toate X" category rows — "offers everything in a
-- group" is now derived from a company having every real leaf tagged
-- individually (see prisma/expand-all-services-tags.ts, run ahead of this
-- migration to re-point every existing assignment first).

DELETE FROM "categories" WHERE "is_all_services" = true;

DROP INDEX "categories_one_all_services_per_parent";

ALTER TABLE "categories" DROP COLUMN "is_all_services";
