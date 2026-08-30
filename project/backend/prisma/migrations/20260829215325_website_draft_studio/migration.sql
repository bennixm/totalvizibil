-- CreateEnum
CREATE TYPE "WebsiteDraftStatus" AS ENUM ('in_progress', 'ready', 'claimed');

-- CreateTable
CREATE TABLE "website_drafts" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "mode" "WebsiteMode" NOT NULL DEFAULT 'easy',
    "plan" TEXT NOT NULL DEFAULT 'free',
    "status" "WebsiteDraftStatus" NOT NULL DEFAULT 'in_progress',
    "step" TEXT NOT NULL DEFAULT 'business',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "turns_used" INTEGER NOT NULL DEFAULT 0,
    "theme" JSONB,
    "content" JSONB,
    "generator" TEXT,
    "claimed_company_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "website_drafts_token_hash_key" ON "website_drafts"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "website_drafts_claimed_company_id_key" ON "website_drafts"("claimed_company_id");

-- CreateIndex
CREATE INDEX "website_drafts_status_idx" ON "website_drafts"("status");
