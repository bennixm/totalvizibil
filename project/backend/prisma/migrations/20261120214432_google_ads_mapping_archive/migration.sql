-- CreateTable
CREATE TABLE "google_ads_subcategory_campaign_archive" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "google_campaign_id" TEXT NOT NULL,
    "archived_on_customer_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "google_ads_subcategory_campaign_archive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_ads_subcategory_campaign_archive_google_campaign_id_key" ON "google_ads_subcategory_campaign_archive"("google_campaign_id");

-- CreateIndex
CREATE INDEX "google_ads_subcategory_campaign_archive_category_id_idx" ON "google_ads_subcategory_campaign_archive"("category_id");
