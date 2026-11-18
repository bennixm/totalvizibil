import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Wallet-transaction types the transaction register can show. `spend`
 *  (credit consumption) moves no money, so its "money" column is 0 and it is
 *  only listed when asked for; it never changes the cash totals. */
export const REVENUE_TXN_TYPES = ['purchase', 'refund', 'adjustment', 'spend'] as const;
export type RevenueTxnType = (typeof REVENUE_TXN_TYPES)[number];

/** The pair the ledger shows when nothing is asked for — unchanged from the
 *  hardcoded behaviour this filter replaced, so an existing caller that
 *  sends no `types` sees exactly the same rows as before. */
export const DEFAULT_REVENUE_TXN_TYPES: readonly RevenueTxnType[] = ['purchase', 'refund'];

export const TXN_STATUS_FILTERS = [
  'completed',
  'pending',
  'processing',
  'failed',
  'canceled',
  'all',
] as const;
export type TxnStatusFilter = (typeof TXN_STATUS_FILTERS)[number];

export const TXN_SORTS = ['date_desc', 'date_asc', 'amount_desc', 'amount_asc'] as const;
export type TxnSort = (typeof TXN_SORTS)[number];

export const EXPORT_FORMATS = ['pdf', 'csv', 'xlsx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export class ListRevenueQuery {
  /** Single-type shortcut used by the page's purchase/refund toggle. Wins
   *  over `types` when both are sent. */
  @IsOptional()
  @IsIn(REVENUE_TXN_TYPES)
  type?: RevenueTxnType;

  /** Multi-select form (`?types=purchase&types=adjustment`). Express gives a
   *  bare string for a single `?types=x`, so it's normalised to an array
   *  before validation. Omitted = `DEFAULT_REVENUE_TXN_TYPES`. */
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null || Array.isArray(value) ? value : [value],
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(REVENUE_TXN_TYPES.length)
  @IsIn(REVENUE_TXN_TYPES, { each: true })
  types?: RevenueTxnType[];

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

  /** Default `completed`: the only rows that moved money/credits. */
  @IsOptional()
  @IsIn(TXN_STATUS_FILTERS)
  status?: TxnStatusFilter;

  /** Free-text search: client name/email, business, description, payment
   *  reference, invoice number, transaction id. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;

  /** Absolute amount bounds, EUR cents (credit face value). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxAmount?: number;

  @IsOptional()
  @IsIn(TXN_SORTS)
  sort?: TxnSort;

  /** Export only: file format (default pdf). */
  @IsOptional()
  @IsIn(EXPORT_FORMATS)
  format?: ExportFormat;

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
