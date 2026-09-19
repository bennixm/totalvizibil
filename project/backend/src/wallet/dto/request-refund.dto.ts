import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

export class RequestRefundDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(100_000)
  credits!: number;
}
