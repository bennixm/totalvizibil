import { getActivePinia, type Store } from 'pinia'

import { clearDraftToken } from '@/services/googleAdsUser'
import { clearUnlockReturn } from '@/lib/unlockReturn'

/** Stores that hold nothing of the signed-in user, or a guest's own work. */
const KEEP = new Set(['auth', 'preferences', 'ui', 'toast', 'confirm', 'feed', 'websiteDraft'])

/**
 * Forgets everything the signed-in user loaded, so the next person on this
 * browser never sees it. Covers EVERY store except KEEP, so a new store is
 * included without having to be listed here.
 */
export function clearSessionData(): void {
  const pinia = getActivePinia() as unknown as { _s: Map<string, Store> } | undefined
  for (const [id, store] of pinia?._s ?? []) {
    if (KEEP.has(id)) continue
    // `reset` also drops what the store keeps in the browser (socket, storage).
    ;(store as Store & { reset?: () => void }).reset?.()
    store.$reset()
  }
  clearDraftToken()
  clearUnlockReturn()
}
