import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

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

  /** Explicit "ignore from/to, show every row ever" — same effect as
   *  sending neither, spelled out so the period-filter UI has one
   *  consistent "Lifetime" action across every finance page instead of
   *  this endpoint's absence-means-everything convention being a special
   *  case callers have to remember. Query strings arrive as the literal
   *  string `"true"`/`"false"`, not a real boolean — normalised before
   *  `@IsBoolean()` checks it. */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  all?: boolean;

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
