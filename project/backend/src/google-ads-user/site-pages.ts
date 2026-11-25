import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { networkErrorText } from '../google-ads/google-ads-network-error';
/**
 * Real pages of a customer's own website, for sitelinks. The platform's own
 * campaigns link to platform pages; a customer's sitelinks must point at
 * THEIR site, so the links are read from the campaign's landing page and
 * every candidate is checked to actually respond before it is offered.
 * Never invents a URL.
 */

const FETCH_TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 1_500_000;
const MAX_CHECKS = 14;
const SKIP_EXT = /\.(jpe?g|png|gif|webp|svg|ico|pdf|zip|rar|docx?|xlsx?|mp4|mp3|css|js|json|xml)$/i;
/** Whole path segments only (so `/contact` is kept while `/cont` is not). */
const SKIP_PATH =
  /(^|\/)(login|logout|signin|sign-in|cart|cos|checkout|account|cont|wp-admin|wp-login|feed|tag|author)(\/|$)/i;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

const PRIVATE = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const)
  PRIVATE.addSubnet(net, bits, 'ipv4');

/** True for an address on the public internet (exported for tests). IPv6 is
 *  an allow-list (2000::/3), minus the ranges that embed or tunnel IPv4. */
const GLOBAL6 = new BlockList();
GLOBAL6.addSubnet('2000::', 3, 'ipv6');
const TUNNEL6 = new BlockList();
TUNNEL6.addSubnet('2002::', 16, 'ipv6');
TUNNEL6.addSubnet('2001::', 32, 'ipv6');

export function isPublicIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return !PRIVATE.check(ip, 'ipv4');
  return kind === 6 && GLOBAL6.check(ip, 'ipv6') && !TUNNEL6.check(ip, 'ipv6');
}

const MAX_REDIRECTS = 5;

/**
 * `fetch` for URLs that come from a customer's campaign: http(s) only, and
 * every hop (redirects included) must resolve to public addresses, so a
 * crafted final URL can never make the server read its own network.
 */
async function safeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let current = new URL(url);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    if (!/^https?:$/.test(current.protocol)) throw new Error('unsupported protocol');
    const host = current.hostname.replace(/^\[|\]$/g, '');
    const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
    if (!ips.length || !ips.every(isPublicIp)) throw new Error('address not allowed');
    const res = await fetch(current, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!next) return res;
    await res.body?.cancel().catch(() => undefined);
    current = new URL(next, current);
  }
  throw new Error('too many redirects');
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TotalvizibilBot/1.0)' },
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/html')) return null;
    const text = await res.text();
    return text.slice(0, MAX_HTML_BYTES);
  } catch {
    return null;
  }
}

export async function responds(url: string): Promise<boolean> {
  try {
    let res = await safeFetch(url, { method: 'HEAD' });
    if (res.status === 405 || res.status === 403) {
      res = await safeFetch(url);
    }
    return res.status < 400;
  } catch {
    return false;
  }
}

/** Pure link extraction (exported for tests). */
export function extractSiteLinks(
  html: string,
  baseUrl: string,
): { url: string; pageName: string }[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const host = base.hostname.replace(/^www\./, '');
  const out: { url: string; pageName: string }[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 40) {
    let u: URL;
    try {
      u = new URL(decodeEntities(m[1]), base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, '') !== host) continue;
    u.hash = '';
    if (SKIP_EXT.test(u.pathname) || SKIP_PATH.test(u.pathname)) continue;
    const key = `${u.hostname}${u.pathname.replace(/\/+$/, '')}${u.search}`;
    if (seen.has(key)) continue;
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || text.length < 2 || text.length > 60) continue;
    seen.add(key);
    out.push({ url: u.toString(), pageName: text });
  }
  return out;
}

/** Distinct, responding pages of the site, most prominent (first in the
 *  page) first, excluding the landing page itself and `exclude`. */
export async function discoverSitePages(
  landingUrl: string,
  exclude: Set<string>,
  count: number,
): Promise<{ url: string; pageName: string }[]> {
  if (!landingUrl || count <= 0) return [];
  const html = await fetchText(landingUrl);
  if (!html) return [];
  const norm = (s: string) => s.replace(/\/+$/, '');
  const excluded = new Set([...exclude, landingUrl].map(norm));
  const candidates = extractSiteLinks(html, landingUrl).filter((c) => !excluded.has(norm(c.url)));
  const out: { url: string; pageName: string }[] = [];
  for (const c of candidates.slice(0, MAX_CHECKS)) {
    if (out.length >= count) break;
    if (await responds(c.url)) out.push(c);
  }
  return out;
}

/** Readable text of a page's HTML (exported for tests). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

const LANDING_TTL_MS = 10 * 60_000;
const MAX_LANDING_TEXT = 6_000;
const landingCache = new Map<string, { at: number; text: string }>();

/** What the landing page says ('' when unreadable). Cached for 10 minutes. */
export async function landingText(url: string): Promise<string> {
  if (!url) return '';
  const hit = landingCache.get(url);
  if (hit && Date.now() - hit.at < LANDING_TTL_MS) return hit.text;
  const html = await fetchText(url);
  const text = html ? htmlToText(html).slice(0, MAX_LANDING_TEXT) : '';
  if (landingCache.size > 500) landingCache.clear();
  landingCache.set(url, { at: Date.now(), text });
  return text;
}

/** Final-URL health checks for the evaluator (same shape as the monitor's). */
export async function checkUrls(
  urls: string[],
): Promise<Map<string, { url: string; ok: boolean; status: number | null; error?: string }>> {
  const map = new Map<
    string,
    { url: string; ok: boolean; status: number | null; error?: string }
  >();
  for (const url of [...new Set(urls)].slice(0, 10)) {
    try {
      const res = await safeFetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TotalvizibilBot/1.0)' },
      });
      map.set(url, { url, ok: res.status < 400, status: res.status });
    } catch (err) {
      map.set(url, {
        url,
        ok: false,
        status: null,
        error: networkErrorText(err),
      });
    }
  }
  return map;
}
