-- AlterTable
ALTER TABLE "feed_query_cache" ADD COLUMN     "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "estimated_cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "input_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "model" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "output_tokens" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "feed_search_daily" (
    "day" DATE NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "stored" INTEGER NOT NULL DEFAULT 0,
    "keyword" INTEGER NOT NULL DEFAULT 0,
    "local" INTEGER NOT NULL DEFAULT 0,
    "ai" INTEGER NOT NULL DEFAULT 0,
    "guess" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "feed_search_daily_pkey" PRIMARY KEY ("day")
);
