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

/** Admin-side primary service-area edit. Category is set separately via PATCH profile. */
export class SetCompanyLocationDto {
  @IsOptional()
  @IsBoolean()
  nationwide?: boolean;

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

  @ValidateIf((o: SetCompanyLocationDto) => !o.nationwide)
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ValidateIf((o: SetCompanyLocationDto) => !o.nationwide)
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ValidateIf((o: SetCompanyLocationDto) => !o.nationwide)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  radiusKm?: number;
}
