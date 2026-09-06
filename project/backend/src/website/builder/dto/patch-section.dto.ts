import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';

export class PatchSectionDto {
  @IsOptional()
  @IsString()
  variant?: string;

  /** Entrance-animation preset id (`''` clears it). Snapped in the service. */
  @IsOptional()
  @IsString()
  animation?: string;

  @IsOptional()
  @IsBoolean()
  visible?: boolean;

  /** Free-form field bag — clamped against the catalog schema in the service. */
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  /** Colour overrides (`{ bg, text, heading, accent }` hex; `''`/junk cleared). */
  @IsOptional()
  @IsObject()
  style?: Record<string, unknown>;
}
