import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { FinancePeriodQuery } from './finance-period.query';
import { EXPORT_FORMATS, type ExportFormat } from './list-revenue.query';

/** The financial report: a period (`from`/`to`/`all`, same semantics as the
 *  overview), or a whole calendar `year` broken down by month. */
export class ReportExportQuery extends FinancePeriodQuery {
  @IsOptional()
  @IsIn(EXPORT_FORMATS)
  format?: ExportFormat;

  /** Annual report (12 monthly columns + total). Wins over from/to. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export class MonthlyReportQuery {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;
}
