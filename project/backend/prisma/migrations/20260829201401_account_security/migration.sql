-- Account & security: password reset, TOTP 2FA. Drops the abandoned website_drafts flow.

-- users: password change tracking + TOTP
ALTER TABLE "users"
  ADD COLUMN "password_changed_at" TIMESTAMP(3),
  ADD COLUMN "totp_secret" TEXT,
  ADD COLUMN "totp_enabled_at" TIMESTAMP(3);

-- password reset tokens
CREATE TABLE "password_reset_tokens" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- remove the anonymous website-draft flow
DROP TABLE IF EXISTS "website_drafts";
DROP TYPE IF EXISTS "WebsiteDraftStatus";
