import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'

export interface AffiliateReferral {
  id: string
  name: string
  emailMasked: string
  status: 'pending' | 'rewarded'
  rewardCredits: number | null
  createdAt: string
  rewardedAt: string | null
  invoiceId: string | null
}

export interface AffiliateStats {
  enabled: boolean
  rewardCredits: number
  minDepositCredits: number
  code: string
  referred: number
  rewarded: number
  creditsEarned: number
  items: AffiliateReferral[]
}

interface State {
  stats: AffiliateStats | null
  loading: boolean
  error: string
}

/** The signed-in user's affiliate panel (Account → Afiliere). */
export const useAffiliateStore = defineStore('affiliate', {
  state: (): State => ({ stats: null, loading: false, error: '' }),

  getters: {
    link: (s): string =>
      s.stats ? `${window.location.origin}/?ref=${s.stats.code}` : '',
  },

  actions: {
    async load(): Promise<void> {
      this.loading = true
      this.error = ''
      try {
        this.stats = await apiFetch<AffiliateStats>('/affiliate/me')
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
      } finally {
        this.loading = false
      }
    },
  },
})
