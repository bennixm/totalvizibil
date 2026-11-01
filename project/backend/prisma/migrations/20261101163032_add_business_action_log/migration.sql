-- CreateTable
CREATE TABLE "business_action_logs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_role" "CompanyRole" NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_action_logs_company_id_created_at_idx" ON "business_action_logs"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "business_action_logs_actor_id_idx" ON "business_action_logs"("actor_id");

-- CreateIndex
CREATE INDEX "admin_audit_logs_created_at_idx" ON "admin_audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "business_action_logs" ADD CONSTRAINT "business_action_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_action_logs" ADD CONSTRAINT "business_action_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
