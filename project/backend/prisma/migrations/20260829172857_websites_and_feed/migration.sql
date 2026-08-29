-- CreateEnum
CREATE TYPE "WebsiteMode" AS ENUM ('easy', 'advanced');

-- CreateEnum
CREATE TYPE "WebsiteStatus" AS ENUM ('draft', 'published', 'unpublished');

-- CreateEnum
CREATE TYPE "WebsiteDraftStatus" AS ENUM ('generating', 'ready', 'claimed', 'abandoned');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "quality_score" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "websites" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "mode" "WebsiteMode" NOT NULL DEFAULT 'easy',
    "status" "WebsiteStatus" NOT NULL DEFAULT 'draft',
    "theme" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    "generator" TEXT NOT NULL DEFAULT 'rule-based-v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "websites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_drafts" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "mode" "WebsiteMode" NOT NULL DEFAULT 'easy',
    "status" "WebsiteDraftStatus" NOT NULL DEFAULT 'ready',
    "input" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    "theme" JSONB NOT NULL,
    "generator" TEXT NOT NULL DEFAULT 'rule-based-v1',
    "claimed_company_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "websites_company_id_key" ON "websites"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "website_drafts_token_key" ON "website_drafts"("token");

-- CreateIndex
CREATE INDEX "website_drafts_status_idx" ON "website_drafts"("status");

-- CreateIndex
CREATE INDEX "companies_status_idx" ON "companies"("status");

-- AddForeignKey
ALTER TABLE "websites" ADD CONSTRAINT "websites_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
