-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "advanced_unlocked_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "websites" ADD COLUMN     "builder_chat" JSONB,
ADD COLUMN     "builder_spec" JSONB;
