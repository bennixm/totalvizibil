import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListCompaniesQuery {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @IsOptional()
  @IsIn(['draft', 'active', 'suspended'])
  status?: 'draft' | 'active' | 'suspended';

  /** `none` = businesses without any campaign row. */
  @IsOptional()
  @IsIn(['none', 'draft', 'active', 'paused', 'depleted'])
  campaign?: 'none' | 'draft' | 'active' | 'paused' | 'depleted';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
