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
  // `influencer` is not a platform role (no admin access); it filters the
  // accounts that have an influencer profile.
  @IsIn(['admin', 'support', 'finance', 'moderator', 'influencer'])
  role?: 'admin' | 'support' | 'finance' | 'moderator' | 'influencer';

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
