import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(2)
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(160)
  legalName?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(2000)
  description?: string;
}
