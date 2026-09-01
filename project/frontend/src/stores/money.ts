import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'

export type DisplayCurrency = 'EUR' | 'RON'

interface MoneyState {
  /** The wallet's chosen display currency. Credits stay EUR-denominated. */
  currency: DisplayCurrency
  /** Live EUR->RON rate, for the RON equivalent shown next to credit amounts. */
  eurRonRate: number
  loaded: boolean
}

// De-dupe concurrent first loads (several views mounting at once).
let inFlight: Promise<void> | null = null

/**
 * FX context shared by every screen that shows a credit amount: which currency
 * to show the "≈" equivalent in, and the rate to convert with. Fed by a cheap
 * `/wallet/fx` call on app start and kept in sync when the user switches it or
 * the full wallet summary reloads.
 */
export const useMoneyStore = defineStore('money', {
  state: (): MoneyState => ({
    currency: 'EUR',
    eurRonRate: 5.05,
    loaded: false,
  }),

  actions: {
    async ensureLoaded(force = false): Promise<void> {
      if (this.loaded && !force) return
      if (inFlight) return inFlight
      inFlight = (async () => {
        try {
          const fx = await apiFetch<{ currency: DisplayCurrency; eurRonRate: number }>('/wallet/fx')
          this.currency = fx.currency
          this.eurRonRate = fx.eurRonRate
          this.loaded = true
        } catch {
          // Leave the safe defaults in place; a credit amount still renders.
        } finally {
          inFlight = null
        }
      })()
      return inFlight
    },

    /** Absorb the currency + rate from a full wallet summary payload. */
    applyFx(fx: { currency?: string; eurRonRate?: number }): void {
      if (fx.currency === 'EUR' || fx.currency === 'RON') this.currency = fx.currency
      if (typeof fx.eurRonRate === 'number' && fx.eurRonRate > 0) this.eurRonRate = fx.eurRonRate
      this.loaded = true
    },

    reset(): void {
      this.$reset()
    },
  },
})
