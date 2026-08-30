-- Wallet becomes a single per-user wallet (was one per company).
-- Each spend is tagged with the business it belongs to for per-campaign tracking.

-- 1. New columns (nullable while we backfill).
ALTER TABLE "wallets" ADD COLUMN "user_id" UUID;
ALTER TABLE "wallet_transactions" ADD COLUMN "company_id" UUID;

-- 2. Attribute existing transactions to the business their wallet belonged to.
UPDATE "wallet_transactions" t
SET "company_id" = w."company_id"
FROM "wallets" w
WHERE w."id" = t."wallet_id";

-- 3. Point every wallet at the owning company's owner.
UPDATE "wallets" w
SET "user_id" = c."owner_user_id"
FROM "companies" c
WHERE c."id" = w."company_id";

-- 4. Merge duplicate wallets (same owner, several businesses) into the oldest one:
--    re-point its transactions, roll its balance into the keeper, drop the rest.
WITH ranked AS (
  SELECT
    "id",
    "user_id",
    "balance_minor",
    ROW_NUMBER() OVER (PARTITION BY "user_id" ORDER BY "created_at" ASC, "id" ASC) AS rn,
    FIRST_VALUE("id") OVER (PARTITION BY "user_id" ORDER BY "created_at" ASC, "id" ASC) AS keeper_id
  FROM "wallets"
)
UPDATE "wallet_transactions" t
SET "wallet_id" = r.keeper_id
FROM ranked r
WHERE t."wallet_id" = r."id" AND r.rn > 1;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "user_id" ORDER BY "created_at" ASC, "id" ASC) AS rn,
    SUM("balance_minor") OVER (PARTITION BY "user_id") AS total
  FROM "wallets"
)
UPDATE "wallets" w
SET "balance_minor" = r.total
FROM ranked r
WHERE w."id" = r."id" AND r.rn = 1;

DELETE FROM "wallets" w
USING (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "user_id" ORDER BY "created_at" ASC, "id" ASC) AS rn
  FROM "wallets"
) r
WHERE w."id" = r."id" AND r.rn > 1;

-- 5. Swap constraints on wallets: company_id -> user_id.
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_company_id_fkey";
DROP INDEX "wallets_company_id_key";
ALTER TABLE "wallets" DROP COLUMN "company_id";

ALTER TABLE "wallets" ALTER COLUMN "user_id" SET NOT NULL;
CREATE UNIQUE INDEX "wallets_user_id_key" ON "wallets"("user_id");
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. Wire up wallet_transactions.company_id.
CREATE INDEX "wallet_transactions_company_id_idx" ON "wallet_transactions"("company_id");
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
