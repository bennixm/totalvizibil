import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'
import type { Money } from '@/stores/wallet'

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'depleted'

export interface CampaignTier {
  cpc: Money
  dailyBudget: Money
}

export interface CampaignData {
  status: CampaignStatus
  dailyBudget: Money
  cpc: Money
  appearFirst: boolean
  activatedAt: string | null
  /** Lifetime credits this campaign has consumed. */
  consumed: Money
  /** Credits spent on clicks so far today (resets daily). */
  spentToday: Money
  /** Lifetime billed clicks. */
  clicks: number
}

export interface CampaignPayload {
  campaign: CampaignData | null
  suggestions: { standard: CampaignTier; appearFirst: CampaignTier }
  /** Shared wallet balance (funds every business the user owns). */
  wallet: { balance: Money }
  consumed: Money
  required: Money
  canActivate: boolean
  runnable: boolean
}

export interface SaveCampaignInput {
  dailyBudget: number
  cpc: number
  appearFirst: boolean
}

interface State {
  data: CampaignPayload | null
  loading: boolean
  working: boolean
  error: string
}

export const useCampaignStore = defineStore('campaign', {
  state: (): State => ({ data: null, loading: false, working: false, error: '' }),

  actions: {
    async load(companyId: string): Promise<void> {
      this.loading = true
      this.error = ''
      try {
        this.data = await apiFetch<CampaignPayload>(`/companies/${companyId}/campaign`)
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
      } finally {
        this.loading = false
      }
    },

    async save(companyId: string, input: SaveCampaignInput): Promise<boolean> {
      return this.run(() =>
        apiFetch<CampaignPayload>(`/companies/${companyId}/campaign`, {
          method: 'PUT',
          body: input,
        }),
      )
    },

    activate(companyId: string): Promise<boolean> {
      return this.run(() =>
        apiFetch<CampaignPayload>(`/companies/${companyId}/campaign/activate`, { method: 'POST' }),
      )
    },

    pause(companyId: string): Promise<boolean> {
      return this.run(() =>
        apiFetch<CampaignPayload>(`/companies/${companyId}/campaign/pause`, { method: 'POST' }),
      )
    },

    async run(fn: () => Promise<CampaignPayload>): Promise<boolean> {
      this.working = true
      this.error = ''
      try {
        this.data = await fn()
        return true
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
        return false
      } finally {
        this.working = false
      }
    },
  },
})
