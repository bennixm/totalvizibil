import { Type } from 'class-transformer';
import { IsInt, Max, Min, IsOptional } from 'class-validator';
import { FinancePeriodQuery } from './finance-period.query';

/** `FinancePeriodQuery` plus paging — for the small tabular finance reports
 *  (voided-invoice register, top-spending companies) that share the exact
 *  same period semantics as the overview (absent = current calendar month). */
export class PagedPeriodQuery extends FinancePeriodQuery {
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
