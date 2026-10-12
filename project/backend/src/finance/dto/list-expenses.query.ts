import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

const CATEGORIES = [
  'hosting',
  'call_center',
  'cloud_storage',
  'domains',
  'google_ads',
  'stripe_fees',
  'other',
] as const;

export class ListExpensesQuery {
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: (typeof CATEGORIES)[number];

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
