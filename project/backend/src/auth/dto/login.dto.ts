import { IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @IsEmail()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @MaxLength(255)
  email!: string;

  @IsString()
  @MaxLength(200)
  password!: string;

  /** 6-digit TOTP code, required only when the account has 2FA enabled. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'The 2FA code must be 6 digits' })
  totpCode?: string;
}
