import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class FeedQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  /**
   * Category filter — one of:
   *  - a bare group slug ("Toate din X") — every subcategory under it, union;
   *  - the `complete-{group}` sentinel ("Servicii complete X") — only
   *    businesses tagged with literally every leaf under that group;
   *  - one or several real leaf slugs, comma-separated — an OR-match across
   *    exactly those subcategories (the feed's multi-select).
   */
  @IsOptional()
  @IsString()
  @MaxLength(400)
  category?: string;

  /** Deprecated — the feed is always ordered by the Visibility Score. Ignored. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  sort?: string;

  /**
   * Service-area filter — one of:
   *  - omitted ("Orice locație") — every business, regardless of area;
   *  - the `"nationwide"` sentinel ("Toată țara") — only businesses that
   *    serve the whole country;
   *  - one or several județ names, comma-separated — an OR-match across
   *    exactly those counties (plus any nationwide business, which reaches
   *    everywhere).
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  county?: string;

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
