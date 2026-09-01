import { Transform, Type } from 'class-transformer';
import { IsNumber, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class AdjustWalletDto {
  /** Credits to add (positive) or claw back (negative). */
  @Type(() => Number)
  @IsNumber()
  @Min(-100_000)
  @Max(100_000)
  credits!: number;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(3)
  @MaxLength(200)
  reason!: string;
}
