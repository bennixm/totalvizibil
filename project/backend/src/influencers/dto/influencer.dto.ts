import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const toUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Admin: make an account an influencer (new or existing, by email). */
export class CreateInfluencerDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @Transform(toUpper)
  @Matches(/^[A-Z0-9-]{3,24}$/, { message: 'influencer_code_invalid' })
  code!: string;

  @IsInt()
  @Min(0)
  @Max(90)
  discountPct!: number;

  @IsInt()
  @Min(0)
  @Max(90)
  commissionPct!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Admin: attach an influencer's code to a user (before their first deposit). */
export class AttachInfluencerCodeDto {
  @Transform(toUpper)
  @Matches(/^[A-Z0-9-]{3,24}$/, { message: 'influencer_code_invalid' })
  code!: string;
}

/** Admin: change an influencer's code, percentages, status or note. */
export class UpdateInfluencerDto {
  @IsOptional()
  @Transform(toUpper)
  @Matches(/^[A-Z0-9-]{3,24}$/, { message: 'influencer_code_invalid' })
  code?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  discountPct?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  commissionPct?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
