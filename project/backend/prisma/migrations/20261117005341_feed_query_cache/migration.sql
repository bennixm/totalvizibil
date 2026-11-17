-- CreateTable
CREATE TABLE "feed_query_cache" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "answer" JSONB NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_hit_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_query_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feed_query_cache_key_key" ON "feed_query_cache"("key");

-- CreateIndex
CREATE INDEX "feed_query_cache_created_at_idx" ON "feed_query_cache"("created_at");
