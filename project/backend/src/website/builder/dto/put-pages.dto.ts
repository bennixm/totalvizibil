import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class BuilderPageDto {
  /** Absent for a newly added page. */
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MaxLength(60)
  title!: string;

  @IsBoolean()
  isHome!: boolean;

  @IsOptional()
  @IsBoolean()
  nav?: boolean;
}

export class PutPagesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => BuilderPageDto)
  pages!: BuilderPageDto[];
}
