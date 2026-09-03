import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AddSectionDto {
  /** A `SectionType` from the catalog — validated against it in the service. */
  @IsString()
  type!: string;

  @IsOptional()
  @IsString()
  variant?: string;

  /** Insertion index within the page's section list; appended when omitted. */
  @IsOptional()
  @IsInt()
  @Min(0)
  index?: number;
}
