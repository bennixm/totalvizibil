-- CreateTable
CREATE TABLE "fx_rates" (
    "date" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "ron_per_unit" DECIMAL(14,6) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'BNR',

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("date","currency")
);

-- CreateIndex
CREATE INDEX "fx_rates_currency_date_idx" ON "fx_rates"("currency", "date");
