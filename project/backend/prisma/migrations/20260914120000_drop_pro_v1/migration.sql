-- PRO V1 (the BuilderDoc-based agentic chat, superseded by PRO V2 / Website
-- Builder) is being removed entirely. Drops its two tables; nothing else
-- references them.
DROP TABLE IF EXISTS "pro_messages";
DROP TABLE IF EXISTS "pro_conversations";
