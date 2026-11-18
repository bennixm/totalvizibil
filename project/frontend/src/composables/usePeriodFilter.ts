import { computed, ref } from 'vue'
import type { PeriodPreset } from '@/components/admin/AdminPeriodFilter.vue'

/**
 * Shared state/logic behind every admin finance page's `AdminPeriodFilter`
 * (Dashboard, Venituri, Costuri, Consum AI) — was copy-pasted identically
 * into all four, which is how a real bug survived in all of them at once:
 * picking a quick preset (Luna aceasta / 3 luni / 12 luni / De la început)
 * never touched `customFrom`/`customTo`, so the "De la"/"Până la" fields sat
 * blank or stale while a preset was the one actually in effect — the two
 * controls looked independent even though they drive the exact same
 * "period" state. Fixed once, here, instead of four times.
 */
export function usePeriodFilter(
  applyPeriod: (from: string | null, to: string | null, lifetime?: boolean) => void,
) {
  const activePreset = ref<PeriodPreset>('month')
  const customFrom = ref('')
  const customTo = ref('')

  function setQuickRange(preset: Exclude<PeriodPreset, 'custom'>): void {
    activePreset.value = preset
    if (preset === 'lifetime') {
      customFrom.value = ''
      customTo.value = ''
      applyPeriod(null, null, true)
      return
    }
    const now = new Date()
    const y = now.getUTCFullYear()
    const m = now.getUTCMonth()
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    let from: Date
    let to: Date | null = null
    if (preset === 'lastMonth') {
      from = new Date(Date.UTC(y, m - 1, 1))
      to = new Date(Date.UTC(y, m, 0))
    } else if (preset === 'year') {
      from = new Date(Date.UTC(y, 0, 1))
    } else {
      const months = { month: 1, '3months': 3, '12months': 12 }[preset]
      from = new Date(Date.UTC(y, m - (months - 1), 1))
    }
    // Keep the date fields showing whatever range the preset just resolved
    // to, instead of leaving them blank/stale — same state, same display.
    customFrom.value = iso(from)
    customTo.value = to ? iso(to) : ''
    applyPeriod(iso(from), to ? iso(to) : null)
  }

  /** A whole calendar month (`YYYY-MM`), e.g. for a monthly closing. */
  function pickMonth(ym: string): void {
    const [yy, mm] = ym.split('-').map(Number)
    if (!yy || !mm) return
    const from = new Date(Date.UTC(yy, mm - 1, 1)).toISOString().slice(0, 10)
    const to = new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10)
    customFrom.value = from
    customTo.value = to
    activePreset.value = 'custom'
    applyPeriod(from, to)
  }

  /** A whole calendar year, e.g. for the annual closing. */
  function pickYear(year: number): void {
    if (!year) return
    customFrom.value = `${year}-01-01`
    customTo.value = `${year}-12-31`
    activePreset.value = 'custom'
    applyPeriod(customFrom.value, customTo.value)
  }

  const canApplyCustom = computed(
    () => !!customFrom.value && (!customTo.value || customTo.value >= customFrom.value),
  )

  function applyCustomRange(): void {
    if (!canApplyCustom.value) return
    activePreset.value = 'custom'
    applyPeriod(customFrom.value, customTo.value || null)
  }

  return {
    activePreset,
    customFrom,
    customTo,
    canApplyCustom,
    setQuickRange,
    applyCustomRange,
    pickMonth,
    pickYear,
  }
}
