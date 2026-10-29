import { createHash } from 'node:crypto';

/**
 * Obvious non-humans we never bill for a click. Deliberately conservative — a
 * missed bot only costs the platform, never the advertiser twice.
 */
const BOT_RE =
  /bot\b|crawl|spider|slurp|scrapy|curl\/|wget|python-requests|httpclient|headless|phantomjs|facebookexternalhit|whatsapp|telegrambot|discordbot|preview|monitoring|uptime|pingdom|lighthouse|gtmetrix/i;

export function isLikelyBot(userAgent: string | undefined | null): boolean {
  const ua = (userAgent ?? '').trim();
  if (ua.length < 8) return true; // empty / stub UA → treat as bot
  return BOT_RE.test(ua);
}

/** yyyy-mm-dd in UTC — the click de-dupe / daily-budget window. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * How many hex chars of every `visitorFingerprint` are the IP-scope prefix.
 * 16 hex chars = 64 bits — far too wide to collide across the real IP space,
 * and the full fingerprint keeps 48 chars (192 bits) of its own entropy.
 */
const IP_SCOPE_PREFIX_LEN = 16;

/**
 * Rolling window + cap for the secondary per-(company, IP) click rate limit
 * enforced in `CampaignService.registerClick`.
 *
 * The de-dupe fingerprint deliberately includes the User-Agent (two real
 * people behind one carrier NAT are different visitors), but a UA header is
 * fully attacker-controlled: varying it per request minted unlimited
 * "distinct" billable clicks against one company from a single IP, draining
 * the whole daily budget in seconds. This cap bounds that regardless of how
 * the UA is varied. 5/hour per listing is far above any plausible organic
 * rate from one shared egress IP (a busy office or campus opening the SAME
 * listing 6+ times an hour from 6+ devices is not a thing), while the
 * worst-case drain from one IP drops to ~5 CPCs/hour — with typical
 * `dailyBudgetMinor` / `cpcMinor` ratios (a day's budget is on the order of a
 * few dozen clicks) a single IP can no longer consume a meaningful share of a
 * day's budget before the owner or the daily cap notices.
 */
export const IP_CLICK_WINDOW_MS = 60 * 60 * 1000;
export const IP_CLICK_WINDOW_LIMIT = 5;

/**
 * The IP-only (no UA) half of a visitor id, stable for one (ip, listing, day).
 * Every `visitorFingerprint` starts with exactly this, which is what lets the
 * secondary rate cap count "clicks from this IP on this listing" with a plain
 * prefix match on the already-stored `ad_clicks.visitor_hash` — no raw IP is
 * ever persisted and no extra column is needed. Keeping the day in here
 * preserves the daily rotation the full fingerprint has always had.
 */
export function ipScopeHash(
  ip: string | undefined | null,
  companyId: string,
  day: string = utcDay(),
): string {
  return createHash('sha256')
    .update(['ipscope', (ip ?? '').trim(), companyId, day].join('|'))
    .digest('hex')
    .slice(0, IP_SCOPE_PREFIX_LEN);
}

/**
 * Privacy-preserving visitor id: only the hash is ever stored. Includes the day
 * so the same person is billed at most once per listing per calendar day.
 *
 * Structurally `ipScopeHash(ip, company, day) || sha256(ip|ua|company|day)` —
 * still one opaque 64-char hex string with the same uniqueness semantics, but
 * now prefix-searchable by IP scope (see `ipScopeHash`).
 */
export function visitorFingerprint(
  ip: string | undefined | null,
  userAgent: string | undefined | null,
  companyId: string,
  day: string = utcDay(),
): string {
  const parts = [(ip ?? '').trim(), (userAgent ?? '').trim().slice(0, 400), companyId, day];
  const full = createHash('sha256').update(parts.join('|')).digest('hex');
  return ipScopeHash(ip, companyId, day) + full.slice(IP_SCOPE_PREFIX_LEN);
}
