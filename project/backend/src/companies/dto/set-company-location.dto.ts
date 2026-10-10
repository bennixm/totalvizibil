import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** Location only — category tagging is a separate endpoint/DTO (see
 *  SetCompanyCategoriesDto), so editing one never requires re-sending the
 *  other's current value. */
export class SetCompanyLocationDto {
  /**
   * The județe served — one or several; required unless `nationwide` is set
   * (picking every județ by hand auto-promotes to nationwide server-side too).
   */
  @ValidateIf((o: SetCompanyLocationDto) => !o.nationwide)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(42)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  counties?: string[];

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

  /** Coverage is the whole country (the explicit shortcut) — no județe needed. */
  @IsOptional()
  @IsBoolean()
  nationwide?: boolean;
}
