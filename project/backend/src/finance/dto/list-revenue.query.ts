import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

/** Wallet-transaction types the Venituri ledger can show. `spend` is
 *  deliberately absent — consumed credit is not income, it's the other side
 *  of a sale already counted when the credits were bought. */
export const REVENUE_TXN_TYPES = ['purchase', 'refund', 'adjustment'] as const;
export type RevenueTxnType = (typeof REVENUE_TXN_TYPES)[number];

/** The pair the ledger shows when nothing is asked for — unchanged from the
 *  hardcoded behaviour this filter replaced, so an existing caller that
 *  sends no `types` sees exactly the same rows as before. */
export const DEFAULT_REVENUE_TXN_TYPES: readonly RevenueTxnType[] = ['purchase', 'refund'];

export class ListRevenueQuery {
  /** Single-type shortcut used by the page's purchase/refund toggle. Wins
   *  over `types` when both are sent. */
  @IsOptional()
  @IsIn(['purchase', 'refund'])
  type?: 'purchase' | 'refund';

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
