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
 * Anonymous, per-browser device id — a random UUID kept in `localStorage`,
 * created once and reused forever. No PII, never sent anywhere but this
 * backend, and purely additive entropy for its click de-dupe fingerprint
 * (see `ad-click.ts`'s `visitorFingerprint`): it only helps the backend tell
 * apart two different real visitors who happen to share both an IP and a
 * User-Agent (carrier-grade NAT on mobile data, identically-imaged office
 * PCs — both routine), which today collide into one "repeat" and the second
 * person's genuine click goes unbilled. Swallows storage errors — a visitor
 * in private mode (or with storage blocked) just gets today's behavior,
 * never worse.
 */
function visitorId(): string | undefined {
  try {
    const existing = localStorage.getItem('tvz.vid')
    if (existing) return existing
    const fresh =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    localStorage.setItem('tvz.vid', fresh)
    return fresh
  } catch {
    return undefined
  }
}

/** How long a `markFeedClick` signal stays valid before `consumeFeedClickQuery`
 *  ignores it — generous enough for slow networks/devices, short enough that
 *  a stale leftover from an abandoned navigation never attaches to the wrong
 *  page load. */
const PENDING_CLICK_WINDOW_MS = 15_000

interface PendingClick {
  slug: string
  category?: string
  county?: string
  gclid?: string
  ts: number
}

/**
 * Record "this navigation is a click-through from the feed" for the listing
 * about to open — read back once, by `consumeFeedClickQuery`, from the
 * `GET /public/companies/:slug` call that loads it.
 *
 * This used to be its own `POST /feed/click` fire-and-forget beacon. That
 * endpoint's URL — it literally contains the word "click" — is exactly the
 * shape ad-blocking / tracking-protection extensions filter by default
 * (uBlock Origin, Brave Shields, Safari ITP), so a real visitor's click could
 * silently never reach the backend: the page still opened, the business was
 * just never billed for it. Folding the SAME signal into the page's own,
 * unavoidable data request removes the separate "tracking-shaped" request
 * entirely — there's nothing left for a blocker to match.
 */
export function markFeedClick(
  slug: string,
  hint?: { category: string | null; county: string },
): void {
  try {
    const pending: PendingClick = {
      slug,
      category: hint?.category ?? undefined,
      county: hint?.county,
      gclid: recentGclid(),
      ts: Date.now(),
    }
    sessionStorage.setItem('tvz.pendingClick', JSON.stringify(pending))
  } catch {
    /* storage unavailable — this page load just won't be billed */
  }
}

/**
 * The query-string suffix (starting with `?`/`&`) to append to this page's
 * `GET /public/companies/:slug` call, consuming (clearing) the pending-click
 * signal `markFeedClick` left — or `''` for a direct/organic visit that never
 * went through the feed. Matches on `slug`, not company id, since the slug is
 * all `FeedAdCard` knows before that request resolves.
 */
export function consumeFeedClickQuery(slug: string): string {
  try {
    const raw = sessionStorage.getItem('tvz.pendingClick')
    if (!raw) return ''
    sessionStorage.removeItem('tvz.pendingClick')
    const pending = JSON.parse(raw) as PendingClick
    if (pending.slug !== slug) return ''
    if (Date.now() - pending.ts > PENDING_CLICK_WINDOW_MS) return ''

    const params = new URLSearchParams({ click: '1' })
    if (pending.category) params.set('category', pending.category)
    if (pending.county) params.set('county', pending.county)
    if (pending.gclid) params.set('gclid', pending.gclid)
    const vid = visitorId()
    if (vid) params.set('vid', vid)
    return `?${params.toString()}`
  } catch {
    return ''
  }
}
