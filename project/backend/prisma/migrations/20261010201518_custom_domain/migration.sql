-- CreateEnum
CREATE TYPE "CustomDomainStatus" AS ENUM ('pending', 'active', 'failed');

-- CreateTable
CREATE TABLE "custom_domains" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "status" "CustomDomainStatus" NOT NULL DEFAULT 'pending',
    "fee_credits_minor" INTEGER NOT NULL,
    "domain_price_credits_minor" INTEGER NOT NULL,
    "registrar_provider" TEXT NOT NULL,
    "registrar_ref" TEXT,
    "dns_configured_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_domains_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custom_domains_domain_key" ON "custom_domains"("domain");

-- CreateIndex
CREATE INDEX "custom_domains_company_id_idx" ON "custom_domains"("company_id");

-- AddForeignKey
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
