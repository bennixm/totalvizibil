import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class PostMessageDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(5000)
  body!: string;

  /** Staff only — an internal note the requester never sees. */
  @IsOptional()
  @IsBoolean()
  internal?: boolean;
}
