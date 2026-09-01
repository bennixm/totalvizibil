import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class UpdateLeadDto {
  @IsOptional()
  @IsIn(['new', 'seen', 'resolved'])
  status?: 'new' | 'seen' | 'resolved';

  /** Stamp the first-response time (feeds the response-rate ranking input). */
  @IsOptional()
  @IsBoolean()
  responded?: boolean;

  /** How the response was logged, when `responded` is set. */
  @IsOptional()
  @IsIn(['email', 'phone', 'manual'])
  via?: 'email' | 'phone' | 'manual';
}
