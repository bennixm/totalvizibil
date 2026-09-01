-- Campaign deletion is instant again; the whole-business deletion carries the grace window instead.
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "deletion_scheduled_at";
ALTER TABLE "companies" ADD COLUMN "deletion_scheduled_at" TIMESTAMP(3);
