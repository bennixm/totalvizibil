import type { LocationQuery, RouteLocationRaw } from 'vue-router'

import { apiFetch } from '@/services/api'
import { feedCategoryRoute } from '@/services/routes'
import type { FeedCategoryNode } from '@/stores/feed'
import type { LocalizedName } from '@/stores/companies'

/** What `POST /feed/interpret` resolved a free-text request to — already
 *  whitelisted server-side against the live taxonomy and the 42 județe. */
export interface AskResult {
  group: string | null
  niches: string[]
  counties: string[]
}

export function interpretAsk(text: string, locale: string): Promise<AskResult> {
  return apiFetch<AskResult>('/feed/interpret', {
    method: 'POST',
    body: { text, locale },
    timeoutMs: 15_000,
  })
}

/** The Feed URL that lands already filtered on the result's category — or
 *  `null` when no category was recognised (the gate then just reveals `/`). */
export function askResultRoute(r: AskResult): RouteLocationRaw | null {
  if (!r.group) return null
  return feedCategoryRoute(r.group, r.niches.length ? r.niches.join(',') : null)
}

/** The Feed's county filter value: comma-joined județe, or `null` = all. */
export function askResultCounty(r: AskResult): string | null {
  return r.counties.length ? r.counties.join(',') : null
}

/** "Instalații sanitare · Cluj" — what the confirmation toast echoes back. */
export function askResultLabel(
  r: AskResult,
  categories: FeedCategoryNode[],
  locale: string,
): string {
  const nameOf = (n: LocalizedName) => n[locale as keyof LocalizedName] ?? n.ro
  const group = categories.find((g) => g.slug === r.group)
  const what = r.niches.length
    ? r.niches
        .map((s) => group?.children.find((c) => c.slug === s))
        .filter((c) => c !== undefined)
        .map((c) => nameOf(c.name))
        .join(', ')
    : group
      ? nameOf(group.name)
      : ''
  return [what, r.counties.join(', ')].filter(Boolean).join(' · ')
}

// --- when the gate shows ---------------------------------------------------
// Once per browser session, the first time `/` is opened bare. Deep links,
// ads landings and anything carrying a query string go straight to the Feed.
const SEEN_KEY = 'tvz.askGateSeen'
/** In-memory twin of the session flag, for when storage is unavailable. */
let seenThisLoad = false

export function shouldShowAskGate(query: LocationQuery): boolean {
  if (Object.keys(query).length > 0) return false
  if (seenThisLoad) return false
  try {
    return sessionStorage.getItem(SEEN_KEY) !== '1'
  } catch {
    return true
  }
}

export function markAskGateSeen(): void {
  seenThisLoad = true
  try {
    sessionStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* private mode / storage disabled — the in-memory flag still covers this load */
  }
}

/** Test-only: reset the in-memory flag between cases. */
export function resetAskGateForTests(): void {
  seenThisLoad = false
}
