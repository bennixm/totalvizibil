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
 * the UA is varied.
 */
export const IP_CLICK_WINDOW_MS = 60 * 60 * 1000;

/**
 * Floor of the per-(company, IP) cap — what a campaign gets when its own
 * budget/CPC aren't known yet (pre-transaction fallback) or are too small for
 * the budget-scaled cap below to raise it any further. Also the ONLY cap a
 * tiny campaign ever sees, so it keeps today's original, well-tested bound.
 */
export const IP_CLICK_WINDOW_LIMIT = 5;

/** Absolute ceiling on the scaled cap below — however large a campaign's
 *  budget, one IP can never be trusted with more than this many "distinct"
 *  visitors an hour against one listing. */
export const IP_CLICK_WINDOW_LIMIT_MAX = 15;

/** Share of a campaign's own daily click budget one IP may burn through
 *  inside one rolling window — see `ipClickWindowLimit`. */
const IP_CLICK_WINDOW_BUDGET_SHARE = 0.3;

/**
 * The per-(company, IP) click cap for THIS campaign, scaled to its own daily
 * budget instead of one flat number for every campaign.
 *
 * A flat 5/hour bounds a small campaign's worst-case single-IP drain to a
 * sane slice of its (also small) daily budget, but it falsely throttles
 * genuine traffic for a popular listing with a bigger budget: real visitors
 * sharing one egress IP are routine in Romania (carrier-grade NAT on mobile
 * data, large offices/campuses), and nothing stops 6+ of them opening the
 * same popular listing within an hour — that's organic demand, not fraud,
 * yet the flat cap turned clicks 6+ into free (`ip_rate`) non-billed visits,
 * silently losing the platform real revenue it should have collected.
 *
 * Scaling the cap to ~30% of how many clicks this campaign's own daily
 * budget could ever buy keeps the SAME protection (bounded worst-case drain
 * relative to a day's spend) while letting a bigger campaign's genuine
 * shared-IP traffic through. `IP_CLICK_WINDOW_LIMIT` is both the floor (never
 * weaker than before) and the fallback when the campaign's budget/CPC aren't
 * available yet; `IP_CLICK_WINDOW_LIMIT_MAX` bounds the worst case in
 * absolute terms even for a very large budget.
 */
export function ipClickWindowLimit(
  campaign?: { dailyBudgetMinor: number; cpcMinor: number } | null,
): number {
  if (!campaign || campaign.cpcMinor <= 0) return IP_CLICK_WINDOW_LIMIT;
  const clicksPerDay = campaign.dailyBudgetMinor / campaign.cpcMinor;
  const scaled = Math.ceil(clicksPerDay * IP_CLICK_WINDOW_BUDGET_SHARE);
  return Math.min(IP_CLICK_WINDOW_LIMIT_MAX, Math.max(IP_CLICK_WINDOW_LIMIT, scaled));
}

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
 * Structurally `ipScopeHash(ip, company, day) || sha256(ip|ua|company|day|visitorId)`
 * — still one opaque 64-char hex string with the same uniqueness semantics,
 * but now prefix-searchable by IP scope (see `ipScopeHash`).
 *
 * `visitorId` is an OPTIONAL, fully client-controlled, privacy-preserving
 * device id (a random UUID the frontend keeps in `localStorage` — see
 * `services/ads.ts`). It exists only to split up IP+UA collisions: without
 * it, two different real people sharing one egress IP AND an identical UA
 * string (carrier-grade NAT on mobile data, or a fleet of identically-imaged
 * office PCs — both routine) hash to the SAME fingerprint, so the second
 * person's genuine visit is silently treated as a free "repeat" and never
 * billed. Because it's attacker-forgeable just like the UA, it is never
 * trusted to grant MORE distinctness than IP+UA already implies on its own
 * (the IP-scope rate cap in `CampaignService.registerClick` is keyed off
 * `ipScopeHash`, which never sees this value) — it only ever helps two
 * genuinely different devices stop colliding; it can't help one device look
 * like many.
 */
export function visitorFingerprint(
  ip: string | undefined | null,
  userAgent: string | undefined | null,
  companyId: string,
  day: string = utcDay(),
  visitorId?: string | null,
): string {
  const parts = [
    (ip ?? '').trim(),
    (userAgent ?? '').trim().slice(0, 400),
    companyId,
    day,
    (visitorId ?? '').trim().slice(0, 100),
  ];
  const full = createHash('sha256').update(parts.join('|')).digest('hex');
  return ipScopeHash(ip, companyId, day) + full.slice(IP_SCOPE_PREFIX_LEN);
}
