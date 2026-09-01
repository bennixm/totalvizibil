import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CategoryNameDto {
  @IsString() @Transform(trim) @MinLength(2) @MaxLength(60) ro!: string;
  @IsString() @Transform(trim) @MinLength(2) @MaxLength(60) en!: string;
  @IsString() @Transform(trim) @MinLength(2) @MaxLength(60) de!: string;
}

export class CreateCategoryDto {
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @MinLength(2)
  @MaxLength(60)
  slug!: string;

  @ValidateNested()
  @Type(() => CategoryNameDto)
  name!: CategoryNameDto;

  @IsOptional()
  @IsString()
  @Transform(trim)
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
}
