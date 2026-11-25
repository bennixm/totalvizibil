import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class ListInvoicesQuery {
  /** Only this user's invoices (the user page in the admin panel). */
  @IsOptional()
  @IsUUID()
  userId?: string;

  /** Matches invoice number, buyer name/email, or the owning user's email. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @IsOptional()
  @IsIn(['issued', 'void'])
  status?: 'issued' | 'void';

  @IsOptional()
  @IsIn(['topup', 'affiliate_reward'])
  kind?: 'topup' | 'affiliate_reward';

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
