/**
 * The seam between "an uploaded website image" and wherever its bytes
 * actually live. Every caller (WebsiteAssetService, the Simple-site draft
 * flow, the Advanced/PRO V2 builders) only ever sees `{ id, url }` — the id
 * to reference the asset by, the url to embed it with. Swapping the backing
 * store later (today: a Postgres `bytes` column; later: a dedicated image
 * bucket/CDN) means writing one new class that implements this interface and
 * rebinding the ASSET_STORAGE token in website.module.ts — no caller changes.
 */

export interface StoredAsset {
  id: string;
  url: string;
}

/** An asset belongs to exactly one of these at a time (a draft, before it's
 *  claimed into a real company; a company, after). */
export interface AssetOwner {
  companyId?: string;
  draftId?: string;
}

export const ASSET_STORAGE = Symbol('ASSET_STORAGE');

export interface AssetStorageProvider {
  /** Persist already-decoded, already-size-checked image bytes. */
  put(bytes: Buffer, mime: string, kind: string, owner: AssetOwner): Promise<StoredAsset>;
  /** Read bytes back for WebsiteAssetController to serve. Only meaningful for
   *  a provider that proxies bytes itself (Postgres, today) — a provider
   *  backed by an external CDN would instead hand out that CDN's own URL from
   *  `put()` above, and this never gets called for those ids. */
  get(id: string): Promise<{ mime: string; bytes: Buffer } | null>;
}
