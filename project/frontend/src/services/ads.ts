import { apiFetch } from './api'

/**
 * Tell the backend a listing was opened from the feed so it can bill the
 * campaign's CPC (spam-protected server-side: once per person per day).
 * Fire-and-forget — `keepalive` lets it finish after the page navigates, and
 * any failure is swallowed so it never blocks the click-through.
 */
export function pingAdClick(companyId: string): void {
  void apiFetch('/feed/click', {
    method: 'POST',
    body: { companyId },
    keepalive: true,
    timeoutMs: 4000,
  }).catch(() => {})
}
