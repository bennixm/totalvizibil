import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  eurRonRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100_000)
  advancedBuilderPriceCredits?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100_000)
  advancedBuilderUnlockBonusCredits?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100_000)
  additionalBusinessPriceCredits?: number;

  // --- invoicing (see BillingModule) ---

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(30)
  invoiceVatRatePct?: number;

  // --- refunds (see WalletModule) ---

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  refundFeePct?: number;

  // --- affiliate program (see AffiliateModule) ---

  @IsOptional()
  @IsBoolean()
  affiliateEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10_000)
  affiliateRewardCredits?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100_000)
  affiliateMinDepositCredits?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  invoiceIssuerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  invoiceIssuerTaxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  invoiceIssuerRegCom?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  invoiceIssuerAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  invoiceIssuerIban?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  invoiceIssuerBank?: string;

  // --- credits discount ---

  @IsOptional()
  @IsBoolean()
  creditsDiscountEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(90)
  creditsDiscountPct?: number;

  // --- Feed CPC-local pricing (see AnalyticsModule / feed-pricing.ts) ---
  // `costPromovare` itself is no longer admin-editable here — it's being
  // replaced by the Google Ads rolling-average CPC sync job (see env.ts's
  // GOOGLE_ADS_* vars), not set by hand.

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000)
  feedMarjaProfitCredits?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000)
  feedMarjaPozitionareCredits?: number;

  // --- Google Ads rolling-average CPC (see GoogleAdsCpcSyncService) ---
  // The average itself is machine-written every sync cycle, never here —
  // these two are the judgment-call safety parameters around it.

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(200)
  googleAdsCpcBufferPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(1000)
  googleAdsMaxCpcCredits?: number;

  // --- custom domains (see DomainsModule) ---

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100_000)
  domainPurchaseFeeCredits?: number;
}
