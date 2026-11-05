import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class AdClickDto {
  /** The listing that was clicked (feed item id). */
  @IsUUID()
  companyId!: string;

  /** The exact subcategory leaf (slug) of the search that produced this impression. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  /** The exact județ of the search, or the "nationwide" sentinel. Omitted = "Orice locație". */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  county?: string;

  /** Google Click ID, carried from `?gclid=...` on landing (see
   *  `router/index.ts`'s `tvz.gclid` capture, mirroring the existing
   *  `tvz.ref` affiliate pattern) — present only when this visitor arrived
   *  via a Google Ads referral within the attribution window. Switches this
   *  click's `costPromovare` to the Google Ads rolling-average CPC instead
   *  of the static default (see `AnalyticsService.marginConfig`). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  gclid?: string;
}
