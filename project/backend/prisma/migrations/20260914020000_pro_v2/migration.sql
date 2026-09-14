-- CreateTable
CREATE TABLE "pro_v2_projects" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pro_v2_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pro_v2_files" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pro_v2_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pro_v2_messages" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" JSONB,
    "model" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "iterations" INTEGER,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pro_v2_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pro_v2_projects_company_id_key" ON "pro_v2_projects"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "pro_v2_files_project_id_path_key" ON "pro_v2_files"("project_id", "path");

-- CreateIndex
CREATE INDEX "pro_v2_messages_project_id_created_at_idx" ON "pro_v2_messages"("project_id", "created_at");

-- AddForeignKey
ALTER TABLE "pro_v2_projects" ADD CONSTRAINT "pro_v2_projects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pro_v2_files" ADD CONSTRAINT "pro_v2_files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pro_v2_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pro_v2_messages" ADD CONSTRAINT "pro_v2_messages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pro_v2_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
