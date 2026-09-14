import { ArrayMaxSize, ArrayMinSize, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** One built `dist/` output file, uploaded from the browser's WebContainer
 *  after `npm run build` — base64 so binary assets (images, fonts) survive
 *  JSON transport intact. */
export class ProV2PublishFileDto {
  @IsString()
  @MaxLength(200)
  path!: string;

  @IsString()
  @MaxLength(8_000_000) // base64 — comfortably covers the byte limit enforced server-side
  contentBase64!: string;
}

export class ProV2PublishDto {
  @ValidateNested({ each: true })
  @Type(() => ProV2PublishFileDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  files!: ProV2PublishFileDto[];
}
