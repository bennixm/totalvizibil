import { defineStore } from 'pinia'

import { apiFetch, errorReason, BASE_URL } from '@/services/api'
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
  /** Every credit that ever reached the wallet, from any source — bought,
   *  an admin grant, an affiliate reward — not just Stripe purchases. */
  obtained: Money
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
  /** How much of the balance can actually be refunded right now — may be
   *  less than `balance` if part of it isn't backed by a real Stripe charge. */
  refundable: Money
}

export interface IssuedInvoice {
  id: string
  number: string
}

export type WalletTxnType = 'purchase' | 'spend' | 'refund' | 'adjustment'
/** Same categories `/wallet/spend-breakdown` reports — filters the list to
 *  exactly the rows a category's total is made of. */
export type SpendCategory = 'clicks' | 'aiUsage' | 'builderUnlock' | 'googleAds' | 'other'
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
  /** A `refund` row's own detail: the fee withheld and its cancel-window
   *  deadline (only while `status: 'pending'`). Null on other row types. */
  feePct: number | null
  feeMinor: Money | null
  processAt: string | null
}

/** One row of the Consumption page's unified ledger — a billed click (its
 *  own Feed: județ + subcategorie + that click's own cost) or any other
 *  spend category, merged and sorted together. */
export interface ConsumptionEntry {
  id: string
  kind: 'click' | 'txn'
  category: SpendCategory
  amount: Money
  /** 1 for a click row; the rolled-up count for an aggregate row; else null. */
  clicks: number | null
  /** Real județ, or the "nationwide" pseudo-county — click rows only. */
  county: string | null
  categorySlug: string | null
  categoryName: { ro: string; en: string; de: string } | null
  description: string | null
  createdAt: string
}

export type PaymentKind = 'purchase' | 'refund'

/** One row of the Wallet page's own Payments/Refunds statement — the same
 *  shape the PDF export mirrors. */
export interface PaymentRow {
  id: string
  status: WalletTxnStatus
  amount: Money
  createdAt: string
  feePct: number | null
  feeMinor: Money | null
  processAt: string | null
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
  /** `completed` = a saved card was charged on the spot; `requires_action`
   *  = the bank wants 3-D Secure at `redirectUrl`; `redirect` = Stripe
   *  Checkout at `redirectUrl`; `pending` = dev stub (no Stripe key). */
  status?: 'completed' | 'requires_action' | 'redirect' | 'pending'
  redirectUrl?: string | null
  invoice?: IssuedInvoice | null
}

/** A card saved on the user's Stripe account (display data only). */
export interface SavedCard {
  id: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
}

interface State {
  summary: WalletSummary | null
  transactions: WalletTxn[]
  nextCursor: string | null
  pending: PendingPurchase | null
  /** Cards saved on Stripe for this user, and whether Stripe is enabled. */
  paymentMethods: SavedCard[]
  paymentMethodsEnabled: boolean
  loading: boolean
  working: boolean
  /** Error code from the API (e.g. `wallet_blocked`), or a raw message. */
  error: string
  /** Extra context for a structured error, e.g. the admin's block reason. */
  errorReason: string | null
  /** The invoice issued by the most recent confirmed deposit, if any. */
  lastInvoice: IssuedInvoice | null
  /** Active transaction-list filters, kept so "load more" continues the same query. */
  txnFilters: {
    companyId: string | null
    type: WalletTxnType | null
    category: SpendCategory | null
    /** Inclusive UTC calendar-day bounds, `YYYY-MM-DD`. */
    from: string | null
    to: string | null
    /** Matches the short id shown in every list (`#` + first 8 chars) —
     *  filters to rows whose full id starts with this. */
    search: string | null
  }
  payments: PaymentRow[]
  paymentsNextCursor: string | null
  /** Active Payments/Refunds statement filters, kept so "load more" continues the same query. */
  paymentsFilters: {
    kind: PaymentKind
    from: string | null
    to: string | null
  }
  /** Bumped on every `loadPayments(false, ...)` call — lets a reply that
   *  arrives after a newer filter change was already issued detect it's
   *  stale and avoid clobbering the newer one's result. */
  paymentsRequestSeq: number
  consumption: ConsumptionEntry[]
  /** A timestamp (not an id) — the merged click/transaction ledger pages by `createdAt`. */
  consumptionNextCursor: string | null
  /** Active Consumption-page filters, kept so "load more" continues the same query. */
  consumptionFilters: {
    companyId: string | null
    category: SpendCategory | null
    from: string | null
    to: string | null
    search: string | null
  }
}

/** The user's single wallet — funds every business they own. */
export const useWalletStore = defineStore('wallet', {
  state: (): State => ({
    summary: null,
    transactions: [],
    nextCursor: null,
    pending: null,
    paymentMethods: [],
    paymentMethodsEnabled: false,
    loading: false,
    working: false,
    error: '',
    errorReason: null,
    lastInvoice: null,
    txnFilters: { companyId: null, type: null, category: null, from: null, to: null, search: null },
    payments: [],
    paymentsNextCursor: null,
    paymentsFilters: { kind: 'purchase', from: null, to: null },
    paymentsRequestSeq: 0,
    consumption: [],
    consumptionNextCursor: null,
    consumptionFilters: { companyId: null, category: null, from: null, to: null, search: null },
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

    /** The server pushed a new balance (any spend, refund or deposit, from
     *  any tab or background work). */
    applyLiveBalance(minor: number): void {
      if (this.summary && this.summary.balance.minor !== minor)
        this.summary.balance = { minor, credits: minor / 100 }
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
      filters?: {
        companyId?: string | null
        type?: WalletTxnType | null
        category?: SpendCategory | null
        from?: string | null
        to?: string | null
        search?: string | null
      },
    ): Promise<void> {
      if (filters !== undefined) {
        this.txnFilters = {
          companyId: filters.companyId ?? null,
          type: filters.type ?? null,
          category: filters.category ?? null,
          from: filters.from ?? null,
          to: filters.to ?? null,
          search: filters.search ?? null,
        }
      }
      const params = new URLSearchParams()
      if (append && this.nextCursor) params.set('cursor', this.nextCursor)
      if (this.txnFilters.companyId) params.set('companyId', this.txnFilters.companyId)
      if (this.txnFilters.type) params.set('type', this.txnFilters.type)
      if (this.txnFilters.category) params.set('category', this.txnFilters.category)
      if (this.txnFilters.from) params.set('from', this.txnFilters.from)
      if (this.txnFilters.to) params.set('to', this.txnFilters.to)
      if (this.txnFilters.search) params.set('search', this.txnFilters.search)
      const q = params.toString() ? `?${params.toString()}` : ''
      const res = await apiFetch<{ items: WalletTxn[]; nextCursor: string | null }>(
        `/wallet/transactions${q}`,
      )
      this.transactions = append ? [...this.transactions, ...res.items] : res.items
      this.nextCursor = res.nextCursor
    },

    /** Same transaction list as a downloadable PDF, scoped to the currently
     *  active filters — same "plain href, cookie rides along" shape as
     *  `paymentsExportUrl()`. */
    transactionsExportUrl(): string {
      const params = new URLSearchParams()
      if (this.txnFilters.companyId) params.set('companyId', this.txnFilters.companyId)
      if (this.txnFilters.type) params.set('type', this.txnFilters.type)
      if (this.txnFilters.category) params.set('category', this.txnFilters.category)
      if (this.txnFilters.from) params.set('from', this.txnFilters.from)
      if (this.txnFilters.to) params.set('to', this.txnFilters.to)
      if (this.txnFilters.search) params.set('search', this.txnFilters.search)
      const q = params.toString() ? `?${params.toString()}` : ''
      return `${BASE_URL}/wallet/transactions/export${q}`
    },

    /** Backs the Consumption page's single merged, filterable, paginated ledger. */
    async loadConsumption(
      append = true,
      filters?: {
        companyId?: string | null
        category?: SpendCategory | null
        from?: string | null
        to?: string | null
        search?: string | null
      },
    ): Promise<void> {
      if (filters !== undefined) {
        this.consumptionFilters = {
          companyId: filters.companyId ?? null,
          category: filters.category ?? null,
          from: filters.from ?? null,
          to: filters.to ?? null,
          search: filters.search ?? null,
        }
      }
      const params = new URLSearchParams()
      if (append && this.consumptionNextCursor) params.set('cursor', this.consumptionNextCursor)
      if (this.consumptionFilters.companyId) params.set('companyId', this.consumptionFilters.companyId)
      if (this.consumptionFilters.category) params.set('category', this.consumptionFilters.category)
      if (this.consumptionFilters.from) params.set('from', this.consumptionFilters.from)
      if (this.consumptionFilters.to) params.set('to', this.consumptionFilters.to)
      if (this.consumptionFilters.search) params.set('search', this.consumptionFilters.search)
      const q = params.toString() ? `?${params.toString()}` : ''
      const res = await apiFetch<{ items: ConsumptionEntry[]; nextCursor: string | null }>(
        `/wallet/consumption${q}`,
      )
      this.consumption = append ? [...this.consumption, ...res.items] : res.items
      this.consumptionNextCursor = res.nextCursor
    },

    /** Same consumption ledger as a downloadable PDF, scoped to the currently
     *  active filters. */
    consumptionExportUrl(): string {
      const params = new URLSearchParams()
      if (this.consumptionFilters.companyId) {
        params.set('companyId', this.consumptionFilters.companyId)
      }
      if (this.consumptionFilters.category) params.set('category', this.consumptionFilters.category)
      if (this.consumptionFilters.from) params.set('from', this.consumptionFilters.from)
      if (this.consumptionFilters.to) params.set('to', this.consumptionFilters.to)
      if (this.consumptionFilters.search) params.set('search', this.consumptionFilters.search)
      const q = params.toString() ? `?${params.toString()}` : ''
      return `${BASE_URL}/wallet/consumption/export${q}`
    },

    /**
     * Backs the Wallet page's own Payments/Refunds statement. A fresh
     * (non-append) call is a filter/tab change replacing the whole list, and
     * those can overlap — e.g. the "from" and "to" date pickers each fire
     * their own call — so replies are tagged with a sequence number and a
     * reply that's no longer the latest one issued is dropped rather than
     * clobbering a newer filter's result with stale data.
     */
    async loadPayments(
      append = true,
      filters?: { kind?: PaymentKind; from?: string | null; to?: string | null },
    ): Promise<void> {
      if (filters !== undefined) {
        this.paymentsFilters = {
          kind: filters.kind ?? this.paymentsFilters.kind,
          from: filters.from ?? null,
          to: filters.to ?? null,
        }
      }
      const seq = append ? this.paymentsRequestSeq : ++this.paymentsRequestSeq
      const params = new URLSearchParams()
      params.set('kind', this.paymentsFilters.kind)
      if (append && this.paymentsNextCursor) params.set('cursor', this.paymentsNextCursor)
      if (this.paymentsFilters.from) params.set('from', this.paymentsFilters.from)
      if (this.paymentsFilters.to) params.set('to', this.paymentsFilters.to)
      const res = await apiFetch<{ items: PaymentRow[]; nextCursor: string | null }>(
        `/wallet/payments?${params.toString()}`,
      )
      // A filter change since this request was issued (`seq` moved on) means
      // this reply — whether a fresh page or a "load more" continuation —
      // belongs to a superseded query; drop it instead of appending rows
      // from the old filter onto the new one's list, or replacing the new
      // list with stale data.
      if (seq !== this.paymentsRequestSeq) return
      this.payments = append ? [...this.payments, ...res.items] : res.items
      this.paymentsNextCursor = res.nextCursor
    },

    /** URL for the same statement as a downloadable PDF, scoped to the
     *  currently active kind/date filters. The session cookie rides along
     *  on a plain navigation, so a direct href is enough — no fetch/blob dance. */
    paymentsExportUrl(): string {
      const params = new URLSearchParams()
      params.set('kind', this.paymentsFilters.kind)
      if (this.paymentsFilters.from) params.set('from', this.paymentsFilters.from)
      if (this.paymentsFilters.to) params.set('to', this.paymentsFilters.to)
      return `${BASE_URL}/wallet/payments/export?${params.toString()}`
    },

    /**
     * Start a top-up. With `paymentMethodId` a saved card is charged right
     * away (no card form); otherwise Stripe Checkout opens, saving the new
     * card when `saveCard` is set. Returns the purchase (or null on error).
     */
    async startPurchase(
      credits: number,
      opts: { paymentMethodId?: string; saveCard?: boolean } = {},
    ): Promise<PendingPurchase | null> {
      this.working = true
      this.error = ''
      this.errorReason = null
      try {
        const res = await apiFetch<PendingPurchase>('/wallet/purchases', {
          method: 'POST',
          body: {
            credits,
            ...(opts.paymentMethodId ? { paymentMethodId: opts.paymentMethodId } : {}),
            ...(opts.saveCard ? { saveCard: true } : {}),
          },
          // A saved-card charge waits for Stripe and the bank.
          timeoutMs: 45_000,
        })
        if (res.status === 'completed') {
          // Already paid and credited server-side: refresh what the page shows.
          this.pending = null
          this.lastInvoice = res.invoice ?? null
          this.summary = await apiFetch<WalletSummary>('/wallet')
          useMoneyStore().applyFx(this.summary)
          await Promise.all([this.loadTransactions(false), this.loadPayments(false)])
        } else {
          this.pending = res
        }
        return res
      } catch (err) {
        this.setError(err)
        return null
      } finally {
        this.working = false
      }
    },

    /** Saved cards (Stripe) for the top-up dialog and the wallet page. */
    async loadPaymentMethods(): Promise<void> {
      try {
        const res = await apiFetch<{ enabled: boolean; cards: SavedCard[] }>(
          '/wallet/payment-methods',
        )
        this.paymentMethodsEnabled = res.enabled
        this.paymentMethods = res.cards
      } catch {
        // Not critical: the dialog falls back to "new card" only.
        this.paymentMethods = []
      }
    },

    async removePaymentMethod(id: string): Promise<boolean> {
      this.working = true
      this.error = ''
      this.errorReason = null
      try {
        const res = await apiFetch<{ enabled: boolean; cards: SavedCard[] }>(
          `/wallet/payment-methods/${id}`,
          { method: 'DELETE' },
        )
        this.paymentMethodsEnabled = res.enabled
        this.paymentMethods = res.cards
        return true
      } catch (err) {
        this.setError(err)
        return false
      } finally {
        this.working = false
      }
    },

    /** The customer left a payment (Stripe "back", closed dialog): close it
     *  at Stripe and here. Returns true when it turned out to be paid. */
    async cancelTransaction(transactionId: string): Promise<boolean> {
      try {
        const res = await apiFetch<WalletSummary & { status: string }>(
          `/wallet/purchases/${transactionId}/cancel`,
          { method: 'POST' },
        )
        const { status, ...summary } = res
        this.summary = summary as WalletSummary
        useMoneyStore().applyFx(this.summary)
        if (status === 'completed') {
          await Promise.all([this.loadTransactions(false), this.loadPayments(false)])
        }
        return status === 'completed'
      } catch {
        return false
      } finally {
        this.pending = null
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
        // Both the general ledger AND the Wallet page's own Payments
        // statement need the just-completed row — without this, "Istoric
        // plăți" keeps showing whatever it had before the payment (e.g. no
        // rows at all for a first top-up) until the user touches a filter
        // or reloads the page.
        await Promise.all([this.loadTransactions(false), this.loadPayments(false)])
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

    /** Request a refund of up to the current (refundable) wallet balance —
     *  starts a 7-day cancel window. Returns false (and sets `error`) on
     *  rejection, e.g. "insufficient balance" or "not enough of the balance
     *  traces back to a real charge". */
    async requestRefund(credits: number): Promise<boolean> {
      this.working = true
      this.error = ''
      this.errorReason = null
      try {
        this.summary = await apiFetch<WalletSummary>('/wallet/refund', {
          method: 'POST',
          body: { credits },
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
      const p = this.pending
      this.pending = null
      // Close it server-side too, so it doesn't sit "pending" in the history.
      if (p) void this.cancelTransaction(p.transactionId)
    },

    reset(): void {
      this.$reset()
    },
  },
})
