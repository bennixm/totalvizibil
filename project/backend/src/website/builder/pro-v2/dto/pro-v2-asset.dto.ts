import { IsString, MaxLength } from 'class-validator';

/** An image the owner attaches in the Website Builder chat — a base64 data
 *  URI, same contract as the existing Advanced/Easy builder asset uploads.
 *  ~6MB of base64 text comfortably covers the 4.5MB decoded-byte limit
 *  `WebsiteAssetService` enforces server-side. */
export class ProV2AssetDto {
  @IsString()
  @MaxLength(6_500_000)
  dataUri!: string;
}
