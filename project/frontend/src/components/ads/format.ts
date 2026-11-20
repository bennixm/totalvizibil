/** Formatting helpers for the Google Ads campaign dashboard. */

/** Google Ads money (micros, in the account's own currency). */
export function adsMoney(
  micros: number | string | null | undefined,
  currency: string | null | undefined,
  locale: string,
): string {
  const v = Number(micros ?? 0) / 1e6
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'EUR',
      maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2,
    }).format(v)
  } catch {
    return v.toFixed(2)
  }
}

/** Wallet minor units (1 credit = 100) to a credits string. */
export function creditsOf(minor: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(minor / 100)
}

export function pct(v: number | null | undefined, locale: string, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '–'
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: digits,
  }).format(v)
}

export function dateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Ad Strength value → tone used by chips. */
export function strengthTone(s: string | null | undefined): 'success' | 'primary' | 'warning' | 'error' | 'neutral' {
  if (s === 'EXCELLENT') return 'success'
  if (s === 'GOOD') return 'primary'
  if (s === 'AVERAGE') return 'warning'
  if (s === 'POOR') return 'error'
  return 'neutral'
}
