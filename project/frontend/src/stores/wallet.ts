import { defineStore } from 'pinia'

import { apiFetch, errorReason } from '@/services/api'
import { useMoneyStore } from '@/stores/money'

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
  blocked: boolean
  blockedReason: string | null
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
  /** Error code from the API (e.g. `wallet_blocked`), or a raw message. */
  error: string
  /** Extra context for a structured error, e.g. the admin's block reason. */
  errorReason: string | null
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
    errorReason: null,
  }),

  actions: {
    setError(err: unknown): void {
      this.error = err instanceof Error ? err.message : 'error'
      this.errorReason = errorReason(err)
    },

    async load(): Promise<void> {
      this.loading = true
      this.error = ''
      this.errorReason = null
      try {
        this.summary = await apiFetch<WalletSummary>('/wallet')
        useMoneyStore().applyFx(this.summary)
        await this.loadTransactions(false)
      } catch (err) {
        this.setError(err)
      } finally {
        this.loading = false
      }
    },

    /** Switch the wallet's display currency (EUR or RON). */
    async setCurrency(currency: 'EUR' | 'RON'): Promise<void> {
      const prev = this.summary?.currency
      if (prev === currency) return
      this.working = true
      this.error = ''
      this.errorReason = null
      try {
        this.summary = await apiFetch<WalletSummary>('/wallet/currency', {
          method: 'PATCH',
          body: { currency },
        })
        useMoneyStore().applyFx(this.summary)
      } catch (err) {
        this.setError(err)
      } finally {
        this.working = false
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
      this.errorReason = null
      try {
        this.pending = await apiFetch<PendingPurchase>('/wallet/purchases', {
          method: 'POST',
          body: { credits },
        })
      } catch (err) {
        this.setError(err)
      } finally {
        this.working = false
      }
    },

    async confirmPending(): Promise<boolean> {
      if (!this.pending) return false
      this.working = true
      this.error = ''
      this.errorReason = null
      try {
        this.summary = await apiFetch<WalletSummary>(
          `/wallet/purchases/${this.pending.transactionId}/confirm`,
          { method: 'POST' },
        )
        useMoneyStore().applyFx(this.summary)
        this.pending = null
        await this.loadTransactions(false)
        return true
      } catch (err) {
        this.setError(err)
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
