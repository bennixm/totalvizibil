import { apiFetch } from '@/services/api'

/**
 * Research doc, Direction 3: a Google Ads conversion fired the moment a
 * feed click is actually billed — the exact same event `consumeFeedClickQuery`
 * gates, never a separate/earlier signal. This is a reporting signal to
 * Google only; it changes nothing about what the platform charges (that
 * logic is untouched, per the explicit instruction not to build a billing
 * fix here).
 *
 * The account's conversion id/label aren't known at build time (the
 * conversion action is created lazily, server-side, once) — so the gtag
 * script itself is injected dynamically, only once `/platform/google-ads-
 * conversion-tag` reports `configured: true`. Until then (not yet created,
 * or Google Ads isn't configured on this deployment at all), every call
 * here is a silent no-op — never breaks the page.
 */

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

let conversionTag: { conversionId: string; conversionLabel: string } | null = null
let initPromise: Promise<void> | null = null

function injectGtagScript(conversionId: string): void {
  window.dataLayer = window.dataLayer || []
  window.gtag = function (...args: unknown[]) {
    window.dataLayer!.push(args)
  }
  window.gtag('js', new Date())
  window.gtag('config', `AW-${conversionId}`)

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=AW-${conversionId}`
  document.head.appendChild(script)
}

/** Call once at app startup (fire-and-forget — never blocks rendering). */
export function initGoogleAdsConversionTracking(): Promise<void> {
  if (!initPromise) {
    initPromise = apiFetch<{ configured: boolean; conversionId?: string; conversionLabel?: string }>(
      '/platform/google-ads-conversion-tag',
    )
      .then((res) => {
        if (res.configured && res.conversionId && res.conversionLabel) {
          conversionTag = { conversionId: res.conversionId, conversionLabel: res.conversionLabel }
          injectGtagScript(res.conversionId)
        }
      })
      .catch(() => {
        // Best-effort — conversion tracking staying off is never a page error.
      })
  }
  return initPromise
}

/** Fire the one "feed click-through" conversion — call exactly where the
 *  click is already billed, never earlier. No-op if tracking never got
 *  configured/loaded. */
export function fireGoogleAdsConversion(): void {
  if (!conversionTag || !window.gtag) return
  window.gtag('event', 'conversion', {
    send_to: `AW-${conversionTag.conversionId}/${conversionTag.conversionLabel}`,
  })
}
