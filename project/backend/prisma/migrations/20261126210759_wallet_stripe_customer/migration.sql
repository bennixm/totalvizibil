-- Stripe Customer per wallet (saved payment methods live in Stripe, never in this DB)
ALTER TABLE "wallets" ADD COLUMN "stripe_customer_id" TEXT;
CREATE UNIQUE INDEX "wallets_stripe_customer_id_key" ON "wallets"("stripe_customer_id");
