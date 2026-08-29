import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEmail()
  @Transform(trimLower)
  @MaxLength(255)
  email?: string;

  /** Required when `email` is being changed. */
  @ValidateIf((o) => o.email !== undefined)
  @IsString()
  @MinLength(1)
  currentPassword?: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword!: string;
}

export class TotpCodeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'The code must be 6 digits' })
  code!: string;
}
