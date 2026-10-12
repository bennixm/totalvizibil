import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const MANUAL_CATEGORIES = [
  'hosting',
  'call_center',
  'cloud_storage',
  'domains',
  'google_ads',
  'stripe_fees',
  'other',
] as const;

export class CreateExpenseDto {
  @IsIn(MANUAL_CATEGORIES)
  category!: (typeof MANUAL_CATEGORIES)[number];

  /** Day this cost belongs to (YYYY-MM-DD) — may be backdated. */
  @IsISO8601()
  incurredOn!: string;

  /** EUR cents. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountMinor!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  note?: string;
}
