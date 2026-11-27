-- AlterTable
ALTER TABLE "referrals" ADD COLUMN     "influencer_id" UUID;

-- AlterTable
ALTER TABLE "wallet_transactions" ADD COLUMN     "discount_pct" INTEGER,
ADD COLUMN     "influencer_id" UUID;

-- CreateTable
CREATE TABLE "influencers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "discount_pct" INTEGER NOT NULL,
    "commission_pct" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "influencers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "influencer_commissions" (
    "id" UUID NOT NULL,
    "influencer_id" UUID NOT NULL,
    "referred_user_id" UUID NOT NULL,
    "purchase_transaction_id" UUID NOT NULL,
    "deposit_eur_cents" INTEGER NOT NULL,
    "deposit_credits_minor" INTEGER NOT NULL,
    "discount_pct" INTEGER NOT NULL,
    "commission_pct" INTEGER NOT NULL,
    "commission_minor" INTEGER NOT NULL,
    "wallet_transaction_id" UUID NOT NULL,
    "invoice_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "influencer_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "influencers_user_id_key" ON "influencers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "influencers_code_key" ON "influencers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "influencer_commissions_referred_user_id_key" ON "influencer_commissions"("referred_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "influencer_commissions_purchase_transaction_id_key" ON "influencer_commissions"("purchase_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "influencer_commissions_wallet_transaction_id_key" ON "influencer_commissions"("wallet_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "influencer_commissions_invoice_id_key" ON "influencer_commissions"("invoice_id");

-- CreateIndex
CREATE INDEX "influencer_commissions_influencer_id_created_at_idx" ON "influencer_commissions"("influencer_id", "created_at");

-- CreateIndex
CREATE INDEX "referrals_influencer_id_idx" ON "referrals"("influencer_id");

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_influencer_id_fkey" FOREIGN KEY ("influencer_id") REFERENCES "influencers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "influencers" ADD CONSTRAINT "influencers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "influencer_commissions" ADD CONSTRAINT "influencer_commissions_influencer_id_fkey" FOREIGN KEY ("influencer_id") REFERENCES "influencers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "influencer_commissions" ADD CONSTRAINT "influencer_commissions_referred_user_id_fkey" FOREIGN KEY ("referred_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

