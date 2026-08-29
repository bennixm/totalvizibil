import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListUsersQuery {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';

  @IsOptional()
  @IsIn(['admin', 'support', 'finance', 'moderator'])
  role?: 'admin' | 'support' | 'finance' | 'moderator';

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  staffOnly?: boolean;

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
