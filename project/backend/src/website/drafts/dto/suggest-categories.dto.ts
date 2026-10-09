import { IsString, MaxLength, MinLength } from 'class-validator';

export class SuggestCategoriesDto {
  /** The parent group already picked in the location step's first select. */
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  parentSlug!: string;
}
