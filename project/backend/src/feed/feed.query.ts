import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class FeedQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  /** Deprecated — the feed is always ordered by the Visibility Score. Ignored. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  sort?: string;

  /** City name — kept for display / a coarse fallback when no coordinates. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  // Coverage-area filter: the searched point + how far around it to look. A
  // business shows when its own service circle overlaps this one.
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

  /** Deprecated — coverage is judged by each business's own radius. Ignored. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  radiusKm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  pageSize?: number = 12;
}
