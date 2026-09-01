import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class LeadsQueryDto {
  @IsOptional()
  @IsIn(['new', 'seen', 'resolved'])
  status?: string;

  @IsOptional()
  @IsIn(['form', 'call'])
  channel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
