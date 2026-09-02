-- CreateTable
CREATE TABLE "website_assets" (
    "id" UUID NOT NULL,
    "draft_id" UUID,
    "company_id" UUID,
    "kind" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "website_assets_draft_id_idx" ON "website_assets"("draft_id");

-- CreateIndex
CREATE INDEX "website_assets_company_id_idx" ON "website_assets"("company_id");
