import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CategoryNameDto } from './create-category.dto';

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @MinLength(2)
  @MaxLength(60)
  slug?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CategoryNameDto)
  name?: CategoryNameDto;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(40)
  icon?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;

  /** '' or null clears the parent (promotes to a top-level group). */
  @IsOptional()
  @IsString()
  parentId?: string | null;
}
