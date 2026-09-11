-- CreateTable
CREATE TABLE "pexels_cache" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "orientation" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "photos" JSONB NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pexels_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pexels_cache_key_key" ON "pexels_cache"("key");

-- CreateIndex
CREATE INDEX "pexels_cache_fetched_at_idx" ON "pexels_cache"("fetched_at");
