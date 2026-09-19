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
  /** A deposit can only ever be confirmed once this is true (see confirmPending). */
  billingProfileComplete: boolean
  /** Completed deposits made before the profile was complete — still need an invoice. */
  unbilledPurchases: number
  /** Current refund processing fee (whole percent), for the confirm dialog. */
  refundFeePct: number
}

export interface IssuedInvoice {
  id: string
  number: string
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
  /** The purchase this row refunds (only set on `type: 'refund'` rows). */
  refundOfId: string | null
  feePct: number | null
  feeMinor: Money | null
  /** A refund's own cancel-window deadline (only while `status: 'pending'`). */
  processAt: string | null
  /** A `purchase` row only: can this specific purchase be refunded right now? */
  refundEligible: boolean
  /** A `purchase` row only: the id of its active (pending/completed) refund, if any. */
  activeRefundId: string | null
}

export interface PendingPurchase {
  transactionId: string
  credits: number
  amount: Money
  eurCents: number
  ronBani: number
  fxRate: number
  provider: string
  /** Present only when Stripe is configured — redirect the browser here. */
  checkoutUrl: string | null
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
  /** The invoice issued by the most recent confirmed deposit, if any. */
  lastInvoice: IssuedInvoice | null
  /** Active transaction-list filters, kept so "load more" continues the same query. */
  txnFilters: { companyId: string | null; type: WalletTxnType | null }
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
    lastInvoice: null,
    txnFilters: { companyId: null, type: null },
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

    /** Fetch the summary only if it isn't already loaded — for pages that
     *  need e.g. `refundFeePct` but don't otherwise call `load()` (which
     *  would also re-fetch the unfiltered transaction list). */
    async ensureSummary(): Promise<void> {
      if (this.summary) return
      this.summary = await apiFetch<WalletSummary>('/wallet')
      useMoneyStore().applyFx(this.summary)
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

    async loadTransactions(
      append = true,
      filters?: { companyId?: string | null; type?: WalletTxnType | null },
    ): Promise<void> {
      if (filters !== undefined) {
        this.txnFilters = { companyId: filters.companyId ?? null, type: filters.type ?? null }
      }
      const params = new URLSearchParams()
      if (append && this.nextCursor) params.set('cursor', this.nextCursor)
      if (this.txnFilters.companyId) params.set('companyId', this.txnFilters.companyId)
      if (this.txnFilters.type) params.set('type', this.txnFilters.type)
      const q = params.toString() ? `?${params.toString()}` : ''
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

    /** Confirms a purchase by its transaction id — works whether `pending` is
     *  still in memory (the dev-stub flow) or the page just reloaded after a
     *  Stripe Checkout redirect (Pinia state lost, only the URL survives). */
    async confirmTransaction(transactionId: string): Promise<boolean> {
      this.working = true
      this.error = ''
      this.errorReason = null
      try {
        const res = await apiFetch<WalletSummary & { invoice: IssuedInvoice }>(
          `/wallet/purchases/${transactionId}/confirm`,
          { method: 'POST' },
        )
        const { invoice, ...summary } = res
        this.summary = summary
        this.lastInvoice = invoice
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

    confirmPending(): Promise<boolean> {
      return this.pending ? this.confirmTransaction(this.pending.transactionId) : Promise.resolve(false)
    },

    /** Request a refund of a completed Stripe purchase — starts its 7-day
     *  cancel window. Returns false (and sets `error`) on rejection, e.g.
     *  "already refunded" or "insufficient balance". */
    async requestRefund(transactionId: string): Promise<boolean> {
      this.working = true
      this.error = ''
      this.errorReason = null
      try {
        this.summary = await apiFetch<WalletSummary>(`/wallet/transactions/${transactionId}/refund`, {
          method: 'POST',
        })
        useMoneyStore().applyFx(this.summary)
        await this.loadTransactions(false)
        return true
      } catch (err) {
        this.setError(err)
        return false
      } finally {
        this.working = false
      }
    },

    /** Cancel a still-pending refund before its 7-day hold elapses. */
    async cancelRefund(refundId: string): Promise<boolean> {
      this.working = true
      this.error = ''
      this.errorReason = null
      try {
        this.summary = await apiFetch<WalletSummary>(`/wallet/refunds/${refundId}/cancel`, {
          method: 'POST',
        })
        useMoneyStore().applyFx(this.summary)
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
