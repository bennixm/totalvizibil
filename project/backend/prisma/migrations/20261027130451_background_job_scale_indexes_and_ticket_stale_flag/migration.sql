-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN     "stale_notified_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "company_locations_county_idx" ON "company_locations"("county");

-- CreateIndex
CREATE INDEX "company_locations_nationwide_idx" ON "company_locations"("nationwide");

-- CreateIndex
CREATE INDEX "leads_status_created_at_idx" ON "leads"("status", "created_at");

-- CreateIndex
CREATE INDEX "website_drafts_expires_at_idx" ON "website_drafts"("expires_at");
