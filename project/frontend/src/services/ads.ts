import { apiFetch } from './api'

/** How long a captured `?gclid=` still counts as "this visit came from
 *  Google Ads" — same idea as a conversion attribution window, just much
 *  shorter, because this charges the business live, not just logs a stat.
 *  Kept in sync with the comment in `router/index.ts`'s capture code. */
const GCLID_WINDOW_MS = 48 * 60 * 60 * 1000

/** The `?gclid=` captured on landing (see `router/index.ts`), or `undefined`
 *  once it's missing or past its attribution window. Swallows storage
 *  errors the same way the capture side does — this must never throw and
 *  block the click it's attached to. */
function recentGclid(): string | undefined {
  try {
    const gclid = localStorage.getItem('tvz.gclid')
    const at = Number(localStorage.getItem('tvz.gclid_at'))
    if (gclid && Number.isFinite(at) && Date.now() - at <= GCLID_WINDOW_MS) return gclid
  } catch {
    /* storage unavailable — ignore */
  }
  return undefined
}

/**
 * Tell the backend a listing was opened from the feed so it can bill the
 * campaign's CPC (spam-protected server-side: once per person per day).
 * Fire-and-forget — `keepalive` lets it finish after the page navigates, and
 * any failure is swallowed so it never blocks the click-through.
 */
export function pingAdClick(
  companyId: string,
  hint?: { category: string | null; county: string },
): void {
  void apiFetch('/feed/click', {
    method: 'POST',
    body: {
      companyId,
      category: hint?.category ?? undefined,
      county: hint?.county,
      gclid: recentGclid(),
    },
    keepalive: true,
    timeoutMs: 4000,
  }).catch(() => {})
}
