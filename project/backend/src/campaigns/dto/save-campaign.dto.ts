import { Type } from 'class-transformer';
import { IsBoolean, IsISO8601, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class SaveCampaignDto {
  /** Daily budget in credits (1 Credit = 1 EUR). */
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100_000)
  dailyBudget!: number;

  /** Cost per click in credits. */
  @Type(() => Number)
  @IsNumber()
  @Min(0.05)
  @Max(1000)
  cpc!: number;

  @IsOptional()
  @IsBoolean()
  appearFirst?: boolean;

  /**
   * AUTO mode: let the platform manage the CPC (always one notch above the top
   * competitor in the category) and keep the campaign running 24/7 within the
   * daily budget cap. Switches itself off if the budget runs out.
   */
  @IsOptional()
  @IsBoolean()
  autoOptimize?: boolean;

  /** The campaign's `updatedAt` as last seen by the caller — lets the admin
   *  panel (where the owner could be editing the same campaign concurrently)
   *  detect and reject a stale save instead of silently overwriting newer
   *  changes. Optional: the owner's own save never needs this, since only
   *  they edit their own campaign. */
  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string;
}
