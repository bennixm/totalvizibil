import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListGoogleAdsAgentActionsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  action?: string;

  @IsOptional()
  @IsIn(['applied', 'pending_approval', 'rejected'])
  status?: 'applied' | 'pending_approval' | 'rejected';

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

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
