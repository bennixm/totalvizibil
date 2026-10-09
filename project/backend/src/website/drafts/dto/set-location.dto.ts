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
  MinLength,
  ValidateIf,
} from 'class-validator';

export class SetLocationDto {
  /** Subcategory slug(s) from the taxonomy — one or several real leaves. Required. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(80, { each: true })
  categorySlugs!: string[];

  /**
   * The județe served — one or several; required unless `nationwide` is set
   * (picking every județ by hand auto-promotes to nationwide server-side too).
   */
  @ValidateIf((o: SetLocationDto) => !o.nationwide)
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
