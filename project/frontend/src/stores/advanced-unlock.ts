import { defineStore } from 'pinia'

import { apiFetch, ApiError } from '@/services/api'

interface UnlockView {
  unlocked: boolean
  priceCredits: number
  wallet: { balance: { credits: number } }
}

interface State {
  view: UnlockView | null
  loading: boolean
  working: boolean
  error: string
}

/** The one-time paid gate for the Website Builder (formerly the old manual
 *  builder's "advanced unlock") — used only by the unlock-payment step
 *  (`CreateUnlockView`). The builder itself re-checks server-side on every
 *  call, so this store only needs to drive that one screen. */
export const useAdvancedUnlockStore = defineStore('advanced-unlock', {
  state: (): State => ({ view: null, loading: false, working: false, error: '' }),

  actions: {
    async load(companyId: string): Promise<void> {
      this.loading = true
      this.error = ''
      try {
        this.view = await apiFetch<UnlockView>(`/companies/${companyId}/pro-v2/unlock`)
      } catch (err) {
        this.error = err instanceof ApiError ? err.message : 'error'
      } finally {
        this.loading = false
      }
    },

    async unlock(companyId: string): Promise<boolean> {
      this.working = true
      this.error = ''
      try {
        await apiFetch(`/companies/${companyId}/pro-v2/unlock`, { method: 'POST' })
        if (this.view) this.view = { ...this.view, unlocked: true }
        return true
      } catch (err) {
        this.error = err instanceof ApiError ? err.message : 'error'
        return false
      } finally {
        this.working = false
      }
    },
  },
})
