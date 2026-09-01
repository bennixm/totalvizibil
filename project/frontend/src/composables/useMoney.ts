import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import { useMoneyStore, type DisplayCurrency } from '@/stores/money'

/**
 * Formats credit amounts for display. Credits are EUR-denominated (1 cr = 1 €);
 * the "≈" equivalent is shown in the wallet's chosen currency — EUR as `€12.50`,
 * RON as `63 lei` at the live rate. Pass `currency` to override (the admin panel
 * shows the *viewed owner's* currency, not the staff member's).
 */
export function useMoney() {
  const { n } = useI18n()
  const store = useMoneyStore()
  const { currency, eurRonRate } = storeToRefs(store)

  /** Localised credit count, e.g. `1,240.5` (no unit). */
  function credits(value: number): string {
    return n(value, { maximumFractionDigits: 2 })
  }

  /** The fiat value of `value` credits in `cur`, with its symbol — no "≈". */
  function fiat(value: number, cur: DisplayCurrency = currency.value): string {
    if (cur === 'RON') {
      const ron = value * eurRonRate.value
      const digits = Math.abs(ron) > 0 && Math.abs(ron) < 10 ? 2 : 0
      return `${n(ron, { minimumFractionDigits: digits, maximumFractionDigits: digits })} lei`
    }
    return `€${n(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  /** `≈ €12.50` / `≈ 63 lei` — the equivalent shown next to a credit amount. */
  function approx(value: number, cur: DisplayCurrency = currency.value): string {
    return `≈ ${fiat(value, cur)}`
  }

  return {
    currency: computed(() => currency.value),
    eurRonRate: computed(() => eurRonRate.value),
    credits,
    fiat,
    approx,
  }
}
