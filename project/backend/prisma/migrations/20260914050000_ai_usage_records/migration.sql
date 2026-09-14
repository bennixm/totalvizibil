-- CreateTable
CREATE TABLE "ai_usage_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "task_category" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "tool_calls" INTEGER NOT NULL DEFAULT 0,
    "iterations" INTEGER NOT NULL DEFAULT 0,
    "pexels_searches" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "repair_attempt" INTEGER,
    "escalated_from" TEXT,
    "succeeded" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_records_user_id_created_at_idx" ON "ai_usage_records"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_records_project_id_created_at_idx" ON "ai_usage_records"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_records_request_id_idx" ON "ai_usage_records"("request_id");

-- AddForeignKey
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pro_v2_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
