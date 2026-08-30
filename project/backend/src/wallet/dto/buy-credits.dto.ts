import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class BuyCreditsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  credits!: number;
}
