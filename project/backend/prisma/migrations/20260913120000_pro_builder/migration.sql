-- CreateTable
CREATE TABLE "pro_conversations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pro_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pro_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" JSONB,
    "model" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "iterations" INTEGER,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pro_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pro_conversations_company_id_key" ON "pro_conversations"("company_id");

-- CreateIndex
CREATE INDEX "pro_messages_conversation_id_created_at_idx" ON "pro_messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "pro_conversations" ADD CONSTRAINT "pro_conversations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pro_messages" ADD CONSTRAINT "pro_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "pro_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
