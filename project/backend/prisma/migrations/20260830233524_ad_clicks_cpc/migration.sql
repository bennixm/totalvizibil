-- CPC metering: per-day spend anchor on the campaign + an ad-click ledger with
-- a per-(company, visitor, day) uniqueness for spam / repeat-click protection.

ALTER TABLE "campaigns" ADD COLUMN "spend_day" DATE;

CREATE TABLE "ad_clicks" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "visitor_hash" TEXT NOT NULL,
    "billed" BOOLEAN NOT NULL DEFAULT false,
    "cost_minor" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_clicks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ad_clicks_company_id_visitor_hash_key" ON "ad_clicks"("company_id", "visitor_hash");
CREATE INDEX "ad_clicks_company_id_created_at_idx" ON "ad_clicks"("company_id", "created_at");

ALTER TABLE "ad_clicks" ADD CONSTRAINT "ad_clicks_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
