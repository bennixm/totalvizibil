import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateSupplierDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsString()
  @Transform(trim)
  @MaxLength(40)
  vatId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @Transform(trim)
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

  /** Days from issue date to due date, used when an invoice has none. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @Matches(/^[A-Z]{3}$/)
  defaultCurrency?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Transform(trim)
  @MaxLength(1000)
  notes?: string | null;
}

export class CalendarQuery {
  @Matches(/^\d{4}-\d{2}$/)
  month!: string;

  @IsOptional()
  @IsIn(['EUR', 'RON'])
  display?: 'EUR' | 'RON';
}

export class VatReportQuery {
  @IsOptional()
  @IsIn(['EUR', 'RON'])
  display?: 'EUR' | 'RON';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export class ConfirmVatDto {
  /** YYYY-MM */
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  period!: string;

  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  /** The deductible VAT the accountant booked for the period, minor units. */
  @IsInt()
  @Min(0)
  confirmedVatMinor!: number;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  note?: string;
}
