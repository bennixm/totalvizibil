import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Category tagging only — the company's service-area location is a separate
 *  endpoint/DTO (see SetCompanyLocationDto). */
export class SetCompanyCategoriesDto {
  /** Subcategory slug(s) from the taxonomy — one or several real leaves. Required. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(80, { each: true })
  categorySlugs!: string[];
}
