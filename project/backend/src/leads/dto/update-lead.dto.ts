import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class UpdateLeadDto {
  @IsOptional()
  @IsIn(['new', 'seen', 'resolved'])
  status?: 'new' | 'seen' | 'resolved';

  /** Stamp the first-response time (feeds the response-rate ranking input). */
  @IsOptional()
  @IsBoolean()
  responded?: boolean;
}
