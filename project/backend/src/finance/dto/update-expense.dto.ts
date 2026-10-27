import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { EXPENSE_CURRENCIES, IsNotFutureDate, type ExpenseCurrency } from './create-expense.dto';

const MANUAL_CATEGORIES = [
  'hosting',
  'call_center',
  'cloud_storage',
  'domains',
  'google_ads',
  'stripe_fees',
  'other',
] as const;

export class UpdateExpenseDto {
  @IsOptional()
  @IsIn(MANUAL_CATEGORIES)
  category?: (typeof MANUAL_CATEGORIES)[number];

  @IsOptional()
  @IsISO8601()
  @IsNotFutureDate()
  incurredOn?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountMinor?: number;

  /** Currency of the supplier document — see `CreateExpenseDto.currency`. */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsIn(EXPENSE_CURRENCIES)
  currency?: ExpenseCurrency;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  note?: string;
}
