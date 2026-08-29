import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const PLATFORM_ROLES = ['admin', 'support', 'finance', 'moderator'] as const;
export type PlatformRoleName = (typeof PLATFORM_ROLES)[number];

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEmail()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';

  /** Full desired set of platform roles; the server reconciles to match. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(PLATFORM_ROLES, { each: true })
  platformRoles?: PlatformRoleName[];

  /** Clear the user's TOTP secret + enrolment. */
  @IsOptional()
  @IsBoolean()
  disableTotp?: boolean;

  /** Revoke every active session for the user. */
  @IsOptional()
  @IsBoolean()
  revokeSessions?: boolean;
}
