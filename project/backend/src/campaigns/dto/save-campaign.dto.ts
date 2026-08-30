import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

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
}
