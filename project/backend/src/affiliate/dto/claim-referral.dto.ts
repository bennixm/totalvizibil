import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class ClaimReferralDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Length(1, 32)
  code!: string;
}
