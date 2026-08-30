import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'

export interface Money {
  minor: number
  credits: number
}

export interface WalletSummary {
  balance: Money
  currency: string
  eurRonRate: number
  depositedEurCents: number
  purchased: Money
  spent: Money
  updatedAt: string
}

export type WalletTxnType = 'purchase' | 'spend' | 'refund' | 'adjustment'
export type WalletTxnStatus = 'pending' | 'completed' | 'failed' | 'canceled'

export interface WalletTxn {
  id: string
  type: WalletTxnType
  status: WalletTxnStatus
  amount: Money
  balanceAfter: Money | null
  eurCents: number | null
  ronBani: number | null
  fxRate: number | null
  provider: string | null
  description: string | null
  companyId: string | null
  companyName: string | null
  /** Rolled-up ad-click count for a daily CPC row (else null). */
  clicks: number | null
  createdAt: string
}

export interface PendingPurchase {
  transactionId: string
  credits: number
  amount: Money
  eurCents: number
  ronBani: number
  fxRate: number
  provider: string
  requiresConfirmation: boolean
}

interface State {
  summary: WalletSummary | null
  transactions: WalletTxn[]
  nextCursor: string | null
  pending: PendingPurchase | null
  loading: boolean
  working: boolean
  error: string
}

/** The user's single wallet — funds every business they own. */
export const useWalletStore = defineStore('wallet', {
  state: (): State => ({
    summary: null,
    transactions: [],
    nextCursor: null,
    pending: null,
    loading: false,
    working: false,
    error: '',
  }),

  actions: {
    async load(): Promise<void> {
      this.loading = true
      this.error = ''
      try {
        this.summary = await apiFetch<WalletSummary>('/wallet')
        await this.loadTransactions(false)
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
      } finally {
        this.loading = false
      }
    },

    async loadTransactions(append = true): Promise<void> {
      const q = append && this.nextCursor ? `?cursor=${this.nextCursor}` : ''
      const res = await apiFetch<{ items: WalletTxn[]; nextCursor: string | null }>(
        `/wallet/transactions${q}`,
      )
      this.transactions = append ? [...this.transactions, ...res.items] : res.items
      this.nextCursor = res.nextCursor
    },

    async startPurchase(credits: number): Promise<void> {
      this.working = true
      this.error = ''
      try {
        this.pending = await apiFetch<PendingPurchase>('/wallet/purchases', {
          method: 'POST',
          body: { credits },
        })
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
      } finally {
        this.working = false
      }
    },

    async confirmPending(): Promise<boolean> {
      if (!this.pending) return false
      this.working = true
      this.error = ''
      try {
        this.summary = await apiFetch<WalletSummary>(
          `/wallet/purchases/${this.pending.transactionId}/confirm`,
          { method: 'POST' },
        )
        this.pending = null
        await this.loadTransactions(false)
        return true
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
        return false
      } finally {
        this.working = false
      }
    },

    cancelPending(): void {
      this.pending = null
    },

    reset(): void {
      this.$reset()
    },
  },
})
