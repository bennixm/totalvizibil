import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class AdClickDto {
  /** The listing that was clicked (feed item id). */
  @IsUUID()
  companyId!: string;

  /** The exact subcategory leaf (slug) of the search that produced this impression. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  /** The exact județ of the search, or the "nationwide" sentinel. Omitted = "Orice locație". */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  county?: string;
}
