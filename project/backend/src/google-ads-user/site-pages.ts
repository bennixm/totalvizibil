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

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TotalvizibilBot/1.0)' },
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/html')) return null;
    const text = await res.text();
    return text.slice(0, MAX_HTML_BYTES);
  } catch {
    return null;
  }
}

async function responds(url: string): Promise<boolean> {
  try {
    let res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 405 || res.status === 403) {
      res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
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
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TotalvizibilBot/1.0)' },
      });
      map.set(url, { url, ok: res.status < 400, status: res.status });
    } catch (err) {
      map.set(url, {
        url,
        ok: false,
        status: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return map;
}
