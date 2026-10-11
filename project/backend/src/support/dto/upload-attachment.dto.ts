import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UploadAttachmentDto {
  /** `data:<mime>;base64,<...>` — the claimed MIME is advisory only, the
   *  service re-derives the real type from the decoded bytes' magic number. */
  @IsString()
  @MinLength(32)
  @MaxLength(8_200_000)
  dataUri!: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(150)
  filename!: string;
}
