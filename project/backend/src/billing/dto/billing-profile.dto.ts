import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * The billing identity a user declares in Account → Facturare. Required fields
 * are shared by both kinds; `taxId`/`regCom` are only required for `company`.
 * See `isProfileComplete` (billing.service.ts) for the single source of truth
 * on what "complete" means — the wallet purchase gate reuses it.
 */
export class BillingProfileDto {
  @IsIn(['individual', 'company'])
  kind!: 'individual' | 'company';

  @IsString()
  @Transform(trim)
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ValidateIf((o: BillingProfileDto) => o.kind === 'company')
  @IsString()
  @Transform(trim)
  @MinLength(2)
  @MaxLength(40)
  taxId?: string;

  @ValidateIf((o: BillingProfileDto) => o.kind === 'company')
  @IsString()
  @Transform(trim)
  @MinLength(2)
  @MaxLength(60)
  regCom?: string;

  @IsOptional()
  @IsBoolean()
  vatPayer?: boolean;

  @IsString()
  @Transform(trim)
  @MinLength(3)
  @MaxLength(200)
  address!: string;

  @IsString()
  @Transform(trim)
  @MinLength(2)
  @MaxLength(80)
  city!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(80)
  county?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(56)
  country?: string;

  @IsOptional()
  @IsEmail()
  @Transform(trimLower)
  @MaxLength(255)
  billingEmail?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(34)
  iban?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(120)
  bankName?: string;
}
