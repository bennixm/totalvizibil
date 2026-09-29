import { Transform } from 'class-transformer';
import { IsEmail, Matches, MaxLength } from 'class-validator';

export class ResendVerificationDto {
  @IsEmail()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @MaxLength(255)
  email!: string;
}

export class VerifyEmailDto {
  @IsEmail()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @MaxLength(255)
  email!: string;

  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code!: string;
}
