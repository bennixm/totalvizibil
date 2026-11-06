import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Optional feed-click-through signal carried on `GET /public/companies/:slug`
 * itself, alongside the normal page-content load — see `PublicCompanyController.bySlug`.
 *
 * This exists to fix a real billing leak: the old separate `POST /feed/click`
 * beacon is a fire-and-forget request whose URL (and the word "click" in it)
 * is exactly the shape privacy/ad-blocking extensions filter by default
 * (uBlock Origin, Brave Shields, Safari ITP's tracker lists). When it's
 * blocked, the visitor still lands on the page — the backend just never
 * hears about the click, so the business is never billed for a real visitor.
 * Folding the same signal into the one request that MUST succeed for the
 * page to render removes that failure mode entirely: there's no separate
 * "tracking-shaped" request left to block.
 */
export class PublicCompanyViewQueryDto {
  /** Set to "1" only when this page load followed a click-through from the
   *  feed (see `markFeedClick` on the frontend) — a direct/organic visit to
   *  this same URL omits it, so it's never billed. */
  @IsOptional()
  @IsIn(['1'])
  click?: '1';

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

  /** Google Click ID, carried from `?gclid=...` on landing — see
   *  `router/index.ts`'s capture code and `services/ads.ts`'s `recentGclid`. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  gclid?: string;

  /** Anonymous, client-generated device id (random UUID in `localStorage`, no
   *  PII) — extra de-dupe entropy alongside IP+UA. Fully optional and
   *  attacker-forgeable, so it only ever REDUCES false "repeat" collisions
   *  between different real devices sharing one IP+UA (e.g. carrier-grade NAT
   *  on mobile data); it is never trusted to grant more than the IP+UA
   *  fingerprint already would on its own. See `ad-click.ts`'s `visitorFingerprint`. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  vid?: string;
}
