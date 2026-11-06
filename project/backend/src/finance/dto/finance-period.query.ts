import { Transform } from 'class-transformer';
import { IsBoolean, IsISO8601, IsOptional } from 'class-validator';

/** Shared "which period" filter for the overview/revenue/AI-usage reports.
 *  Both ends are inclusive dates (YYYY-MM-DD); absent = defaults applied by
 *  the service (current calendar month). `all=true` asks for literally every
 *  row instead — see `FinanceService.resolveRange()`. */
export class FinancePeriodQuery {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  /** Query strings arrive as the literal string `"true"`/`"false"`, not a
   *  real boolean — normalised before `@IsBoolean()` checks it. */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  all?: boolean;
}
