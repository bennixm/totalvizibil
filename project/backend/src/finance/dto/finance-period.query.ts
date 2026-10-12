import { IsISO8601, IsOptional } from 'class-validator';

/** Shared "which period" filter for the overview/revenue/AI-usage reports.
 *  Both ends are inclusive dates (YYYY-MM-DD); absent = defaults applied by
 *  the service (current calendar month). */
export class FinancePeriodQuery {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
