import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

/** Rejects a date later than today (UTC) — a future-dated expense would sit
 *  at the top of the list (ordered newest-first) forever, but every report's
 *  period range caps `to` at today, so it would never actually be
 *  subtracted from anything until that date arrives. */
export function IsNotFutureDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNotFutureDate',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          const d = new Date(value);
          return !Number.isNaN(d.getTime()) && d.getTime() <= Date.now();
        },
        defaultMessage(): string {
          return 'incurredOn cannot be in the future';
        },
      },
    });
  };
}

/** Currencies a supplier invoice may be entered in. `PlatformExpense.currency`
 *  defaults to EUR in the schema and every aggregate in this module is EUR
 *  cents, so a non-EUR row records the ORIGINAL document's currency for
 *  bookkeeping/audit — it is not converted. */
export const EXPENSE_CURRENCIES = ['EUR', 'RON', 'USD'] as const;
export type ExpenseCurrency = (typeof EXPENSE_CURRENCIES)[number];
export const DEFAULT_EXPENSE_CURRENCY: ExpenseCurrency = 'EUR';

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

  /** Day this cost belongs to (YYYY-MM-DD) — may be backdated, never future-dated. */
  @IsISO8601()
  @IsNotFutureDate()
  incurredOn!: string;

  /** EUR cents. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountMinor!: number;

  /** Currency of the supplier document. Absent = EUR (the schema default). */
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
