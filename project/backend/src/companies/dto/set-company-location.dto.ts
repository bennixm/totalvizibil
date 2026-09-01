import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class SetCompanyLocationDto {
  /** Exact-niche category (leaf slug from the taxonomy). Required. */
  @IsString()
  @MaxLength(80)
  categorySlug!: string;

  /** Required unless `nationwide` is set — whole-country coverage has no city. */
  @ValidateIf((o: SetCompanyLocationDto) => !o.nationwide)
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  /** Required unless `nationwide` is set. */
  @ValidateIf((o: SetCompanyLocationDto) => !o.nationwide)
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  /** Required unless `nationwide` is set. */
  @ValidateIf((o: SetCompanyLocationDto) => !o.nationwide)
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  /** Coverage is the whole country — no city and no radius apply. */
  @IsOptional()
  @IsBoolean()
  nationwide?: boolean;

  /** Required unless `nationwide` is set. */
  @ValidateIf((o: SetCompanyLocationDto) => !o.nationwide)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  radiusKm?: number;
}
