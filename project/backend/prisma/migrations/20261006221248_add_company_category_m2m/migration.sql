-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "is_all_services" BOOLEAN NOT NULL DEFAULT false;

-- Exactly one "Toate X" synthetic leaf per parent group.
CREATE UNIQUE INDEX "categories_one_all_services_per_parent"
  ON "categories" ("parent_id")
  WHERE "is_all_services" = true;

-- CreateTable
CREATE TABLE "company_categories" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_categories_company_id_idx" ON "company_categories"("company_id");

-- CreateIndex
CREATE INDEX "company_categories_category_id_idx" ON "company_categories"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_categories_company_id_category_id_key" ON "company_categories"("company_id", "category_id");

-- AddForeignKey
ALTER TABLE "company_categories" ADD CONSTRAINT "company_categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_categories" ADD CONSTRAINT "company_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
