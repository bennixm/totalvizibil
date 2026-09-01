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
  /** AUTO mode: the platform manages the CPC and keeps the campaign live 24/7. */
  autoOptimize: boolean
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
  /** Highest CPC a live rival in this category bids — what AUTO stays above. */
  marketCpc: Money
  /** AUTO can't beat the market within the daily budget — raise the budget. */
  autoBudgetLimited: boolean
  /** Shared wallet (funds every business the user owns). `currency` + `eurRonRate`
   *  drive the credit-equivalent shown in the owner's chosen currency. */
  wallet: { balance: Money; currency: 'EUR' | 'RON'; eurRonRate: number }
  consumed: Money
  required: Money
  canActivate: boolean
  /** Advanced-plan business whose website builder isn't finished — can't go live yet. */
  requiresWebsiteBuilder: boolean
  runnable: boolean
}

export interface SaveCampaignInput {
  dailyBudget: number
  cpc: number
  appearFirst: boolean
  autoOptimize?: boolean
}

export type OptimizationArea = 'plan' | 'response' | 'age' | 'cpc'

export interface OptimizationFinding {
  area: OptimizationArea
  severity: 'high' | 'medium'
  scorePct: number
  weightPct: number
  gainPct: number
}

export interface CampaignOptimization {
  status: CampaignStatus | null
  rank: { position: number; total: number } | null
  visibility: {
    score: number
    parts: { cpc: number; response: number; plan: number; age: number }
    weights: { cpc: number; response: number; plan: number; age: number }
  }
  response: { avgMinutes: number | null; ratePct: number | null; responded: number; total: number }
  activeDays: number
  ageFullDays: number
  planMode: string | null
  currentCpc: Money | null
  currentDailyBudget: Money | null
  recommended: { cpc: Money; dailyBudget: Money }
  findings: OptimizationFinding[]
}

export interface SpendPoint {
  date: string
  spent: number
  clicks: number
  capped: boolean
}

export interface SpendInsight {
  key: 'raise_budget' | 'low_runway' | 'underspending'
  value: number
}

export interface CampaignSpend {
  hasCampaign: boolean
  status: CampaignStatus | null
  autoOptimize: boolean
  /** Advanced-plan site whose builder isn't finished — activation is blocked. */
  requiresWebsiteBuilder: boolean
  /** Wallet funds a full day and (if advanced) the builder is done. */
  canActivate: boolean
  /** Position in the category group while live, else null. */
  feedRank: { position: number; total: number } | null
  /** Server clock at the time of the request — the client ticks projections off this. */
  now: string
  cpcSet: Money
  dailyBudget: Money
  today: {
    spent: Money
    remaining: Money
    pct: number
    clicks: number
    cpcEffective: Money | null
    burnPerHour: Money
    hoursElapsed: number
    projectedExhaustAt: string | null
    capHitAt: string | null
    depleted: boolean
  }
  lifetime: {
    consumed: Money
    clicks: number
    cpcEffective: Money | null
    activeDays: number
    activeSeconds: number
    costPerActiveDay: Money | null
    clicksPerActiveDay: number | null
  }
  runway: {
    walletBalance: Money
    avgDailySpend: Money
    daysAtBudget: number | null
    daysAtRecentPace: number | null
  }
  clickQuality: {
    billed: number
    unbilled: number
    byReason: Array<{ reason: string; count: number }>
  }
  series: SpendPoint[]
  insights: SpendInsight[]
}

interface State {
  data: CampaignPayload | null
  optimization: CampaignOptimization | null
  spend: CampaignSpend | null
  loading: boolean
  working: boolean
  error: string
}

export const useCampaignStore = defineStore('campaign', {
  state: (): State => ({
    data: null,
    optimization: null,
    spend: null,
    loading: false,
    working: false,
    error: '',
  }),

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

    async loadOptimization(companyId: string): Promise<void> {
      this.loading = true
      this.error = ''
      try {
        this.optimization = await apiFetch<CampaignOptimization>(
          `/companies/${companyId}/campaign/optimization`,
        )
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
      } finally {
        this.loading = false
      }
    },

    async loadSpend(companyId: string): Promise<void> {
      this.loading = true
      this.error = ''
      try {
        this.spend = await apiFetch<CampaignSpend>(`/companies/${companyId}/campaign/spend`)
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

    /** Delete the campaign for good (it leaves the feed first). */
    async remove(companyId: string): Promise<boolean> {
      this.working = true
      this.error = ''
      try {
        await apiFetch(`/companies/${companyId}/campaign`, { method: 'DELETE' })
        this.data = null
        this.spend = null
        return true
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
        return false
      } finally {
        this.working = false
      }
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
