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
 * Privacy-preserving visitor id: only the hash is ever stored. Includes the day
 * so the same person is billed at most once per listing per calendar day.
 */
export function visitorFingerprint(
  ip: string | undefined | null,
  userAgent: string | undefined | null,
  companyId: string,
  day: string = utcDay(),
): string {
  const parts = [(ip ?? '').trim(), (userAgent ?? '').trim().slice(0, 400), companyId, day];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
