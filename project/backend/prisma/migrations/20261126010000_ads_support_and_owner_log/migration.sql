ALTER TABLE "business_action_logs" ALTER COLUMN "company_id" DROP NOT NULL,
ALTER COLUMN "actor_role" DROP NOT NULL;
ALTER TABLE "support_tickets" ADD COLUMN "ads_campaign_id" UUID;
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_ads_campaign_id_fkey" FOREIGN KEY ("ads_campaign_id") REFERENCES "google_ads_user_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
