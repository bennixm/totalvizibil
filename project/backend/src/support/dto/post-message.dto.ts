import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

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

  /** Ids from the separate `POST .../attachments` upload step — attached to
   *  this message once it's actually sent. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUUID('4', { each: true })
  attachmentIds?: string[];
}
