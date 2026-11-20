/**
 * "Add credits, then come back to unlock" detour of the advanced onboarding.
 *
 * The unlock step sends the owner to /wallet with `?from=unlock&c=…` so the
 * wallet page (and the guide, see flowGuideTours.ts) can help them top up and
 * return. A Stripe Checkout round-trip reloads the whole SPA on a URL that
 * carries only `checkout`/`txn`, so the same intent is also remembered in
 * sessionStorage for a short while and restored from there.
 */
import type { LocationQuery, LocationQueryRaw } from 'vue-router'

export interface UnlockReturn {
  /** Company id the unlock is for. */
  c: string
  /** Original unlock flow (`upgrade` for an existing business). */
  flow?: string
}

const KEY = 'tvz.unlockReturn.v1'
const MAX_AGE_MS = 2 * 60 * 60 * 1000

export function rememberUnlockReturn(r: UnlockReturn): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...r, at: Date.now() }))
  } catch {
    /* storage blocked: the query string still carries the intent */
  }
}

export function readStoredUnlockReturn(): UnlockReturn | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as { c?: unknown; flow?: unknown; at?: unknown }
    if (typeof v.c !== 'string' || !v.c) return null
    if (typeof v.at !== 'number' || Date.now() - v.at > MAX_AGE_MS) return null
    return { c: v.c, ...(typeof v.flow === 'string' ? { flow: v.flow } : {}) }
  } catch {
    return null
  }
}

export function clearUnlockReturn(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/** The detour carried by the current URL, if any. */
export function unlockReturnFromQuery(q: LocationQuery): UnlockReturn | null {
  if (q.from !== 'unlock' || typeof q.c !== 'string' || !q.c) return null
  return { c: q.c, ...(typeof q.flow === 'string' ? { flow: q.flow } : {}) }
}

/** Wallet query that keeps the detour visible (for the guide + banner). */
export function walletQueryFor(r: UnlockReturn): LocationQueryRaw {
  return { from: 'unlock', c: r.c, ...(r.flow ? { flow: r.flow } : {}) }
}

/** Where "Back to unlock" goes. */
export function unlockRouteFor(r: UnlockReturn) {
  return {
    name: 'create-unlock',
    query: { c: r.c, flow: r.flow === 'upgrade' ? 'upgrade' : 'onboarding' },
  }
}
