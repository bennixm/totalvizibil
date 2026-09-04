import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

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
}
