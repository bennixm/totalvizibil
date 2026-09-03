import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class BuilderAddAssetDto {
  /** `data:image/(png|jpeg|webp|gif);base64,...` — decoded and stored as bytes. */
  @IsString()
  @MinLength(32)
  @MaxLength(11_000_000)
  dataUri!: string;

  @IsIn(['hero', 'gallery', 'team', 'logo', 'about'])
  kind!: 'hero' | 'gallery' | 'team' | 'logo' | 'about';
}
