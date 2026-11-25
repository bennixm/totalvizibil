/**
 * "Add credits, then back to the Google Ads campaign" detour. The campaign
 * pages send the owner to /wallet with `?from=ads&ads=<id>`; a Stripe
 * Checkout round-trip reloads the SPA without that query, so the intent is
 * also kept in sessionStorage for a short while (same idea as unlockReturn).
 */
import type { LocationQuery, RouteLocationRaw } from 'vue-router'

export interface AdsReturn {
  /** Customer campaign id (GoogleAdsUserCampaign). */
  id: string
  tab?: string
}

const KEY = 'tvz.adsReturn.v1'
const MAX_AGE_MS = 2 * 60 * 60 * 1000

export function walletForAds(r: AdsReturn): RouteLocationRaw {
  return { name: 'wallet', query: { topup: '1', from: 'ads', ads: r.id, ...(r.tab ? { tab: r.tab } : {}) } }
}

export function adsReturnFromQuery(q: LocationQuery): AdsReturn | null {
  if (q.from !== 'ads' || typeof q.ads !== 'string' || !q.ads) return null
  const r = { id: q.ads, ...(typeof q.tab === 'string' ? { tab: q.tab } : {}) }
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...r, at: Date.now() }))
  } catch {
    /* storage blocked: the query string still carries the intent */
  }
  return r
}

export function readStoredAdsReturn(): AdsReturn | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as { id?: unknown; tab?: unknown; at?: unknown } | null
    if (!v || typeof v.id !== 'string' || typeof v.at !== 'number' || Date.now() - v.at > MAX_AGE_MS) return null
    return { id: v.id, ...(typeof v.tab === 'string' ? { tab: v.tab } : {}) }
  } catch {
    return null
  }
}

export function clearAdsReturn(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* storage blocked */
  }
}

export function adsRouteFor(r: AdsReturn): RouteLocationRaw {
  return { name: 'ads-dashboard', params: { id: r.id }, query: r.tab ? { tab: r.tab } : {} }
}
