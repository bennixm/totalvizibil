import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';

export class PatchSectionDto {
  @IsOptional()
  @IsString()
  variant?: string;

  @IsOptional()
  @IsBoolean()
  visible?: boolean;

  /** Free-form field bag — clamped against the catalog schema in the service. */
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;
}
