import { Type } from 'class-transformer';
import {
  IsBoolean,
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

  /** The județ served — required unless `nationwide` is set. */
  @ValidateIf((o: SetCompanyLocationDto) => !o.nationwide)
  @IsString()
  @MaxLength(40)
  county?: string;

  /** Optional — the map pin / exact-address display, not used for matching. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;
}
