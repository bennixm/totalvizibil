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
    const months = { month: 1, '3months': 3, '12months': 12 }[preset]
    const now = new Date()
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1))
    const fromStr = from.toISOString().slice(0, 10)
    // Keep the date fields showing whatever range the preset just resolved
    // to, instead of leaving them blank/stale — same state, same display.
    customFrom.value = fromStr
    customTo.value = ''
    applyPeriod(fromStr, null)
  }

  const canApplyCustom = computed(
    () => !!customFrom.value && (!customTo.value || customTo.value >= customFrom.value),
  )

  function applyCustomRange(): void {
    if (!canApplyCustom.value) return
    activePreset.value = 'custom'
    applyPeriod(customFrom.value, customTo.value || null)
  }

  return { activePreset, customFrom, customTo, canApplyCustom, setQuickRange, applyCustomRange }
}
