-- Leads: contact-form messages + "call" taps from a company's generated site,
-- surfaced in the panel with response-time tracking.

CREATE TYPE "LeadChannel" AS ENUM ('form', 'call');
CREATE TYPE "LeadStatus" AS ENUM ('new', 'seen', 'resolved');

CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "channel" "LeadChannel" NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "message" TEXT,
    "visitor_hash" TEXT NOT NULL,
    "first_response_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "leads_company_id_visitor_hash_key" ON "leads"("company_id", "visitor_hash");
CREATE INDEX "leads_company_id_status_created_at_idx" ON "leads"("company_id", "status", "created_at");
CREATE INDEX "leads_company_id_channel_idx" ON "leads"("company_id", "channel");

ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
