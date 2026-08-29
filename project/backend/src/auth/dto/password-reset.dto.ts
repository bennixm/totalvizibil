import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @MaxLength(255)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}
