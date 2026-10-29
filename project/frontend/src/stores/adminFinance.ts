import { defineStore } from 'pinia'

import { apiFetch, ApiError, BASE_URL } from '@/services/api'

/**
 * Why every fetcher below has a `catch`: they used to be
 * `try { … } finally { loading = false }` with no catch at all, so ANY
 * backend failure — a 403 for the wrong staff role, a timeout, a 500 —
 * resolved into an untouched empty list/null overview and rendered as a
 * calm "no data" page with nothing to say something had gone wrong. Each
 * call now records its own reason, which the views surface as an error
 * empty-state (the shape `AdminUserDetailView`'s `loadError` already used).
 */
function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return 'request failed'
}

export type ExpenseCategory =
  | 'hosting'
  | 'call_center'
  | 'cloud_storage'
  | 'domains'
  | 'google_ads'
  | 'stripe_fees'
  | 'other'

export type ExpenseCurrency = 'EUR' | 'RON' | 'USD'

/** Mirrors the backend's `oneOffFeeCategory()` buckets. */
export interface OneOffFeeBreakdown {
  aiUsage: number
  builderUnlock: number
  other: number
}

export interface VatBreakdownRow {
  vatRatePct: number
  currency: string
  invoiceCount: number
  subtotalMinor: number
  vatMinor: number
  totalMinor: number
}

export interface FinanceTrendPoint {
  date: string
  revenueMinor: number
  costMinor: number
  purchaseMoneyMinor: number
  refundMoneyMinor: number
  refundRatioPct: number
}

export interface FinanceOverview {
  range: { from: string; to: string }
  revenueMinor: number
  operatingCostMinor: number
  aiCostMinor: number
  totalCostMinor: number
  profitMinor: number
  expensesByCategory: Record<ExpenseCategory, number>
  paidTraffic: {
    cpcRevenueMinor: number
    /** The same CPC consumption weighted by the period's gross→net ratio. */
    cpcRevenueRealMoneyMinor: number
    adSpendMinor: number
    profitMinor: number
    realMoneyProfitMinor: number
  }
  otherFeesConsumedMinor: number
  otherFeesByCategory: OneOffFeeBreakdown
  creditConsumption: {
    recurringMinor: number
    oneTimeMinor: number
    oneTimeByCategory: OneOffFeeBreakdown
  }
  /** Credit face value sold vs money actually collected; delta = discount cost. */
  grossRevenueMinor: number
  netRevenueMinor: number
  discountCostMinor: number
  grossToNetRatio: number
  refundsMoneyMinor: number
  refundRatioPct: number
  refundFeeIncomeMinor: number
  /** Point-in-time (all-time) balance-sheet figures. */
  walletLiabilityMinor: number
  blockedWalletBalanceMinor: number
  refundLiabilityInFlightMinor: number
  vatBreakdown: VatBreakdownRow[]
  trend: FinanceTrendPoint[]
}

export type RevenueTxnType = 'purchase' | 'refund' | 'adjustment'

export interface RevenueRow {
  id: string
  type: RevenueTxnType
  /** Credit face value (what the wallet moved). */
  amountMinor: number
  /** Real money (what the bank moved) — reconciles with the dashboard KPI. */
  moneyMinor: number
  createdAt: string
  userName: string | null
  userEmail: string | null
  companyName: string | null
  description: string | null
}

export interface ExpenseRow {
  id: string
  category: ExpenseCategory
  incurredOn: string
  amountMinor: number
  currency: string
  source: 'manual' | 'stripe_api'
  note: string | null
  createdBy: { name: string } | null
}

export interface VoidedInvoiceRow {
  id: string
  number: string
  kind: 'topup' | 'affiliate_reward'
  issuedAt: string
  voidedAt: string
  voidReason: string | null
  currency: string
  subtotalMinor: number
  vatMinor: number
  totalMinor: number
  buyerName: string
}

export interface TopCompanyRow {
  companyId: string
  companyName: string | null
  companySlug: string | null
  spendMinor: number
  clicks: number
}

export interface AiUsageModelRow {
  provider: string
  model: string
  calls: number
  tokens: number
  costMinor: number
}

export interface AiUsageReport {
  range: { from: string; to: string }
  totalCostMinor: number
  totalTokens: number
  totalCalls: number
  byModel: AiUsageModelRow[]
}

export interface PeriodFilter {
  from: string | null
  to: string | null
}

interface AdminFinanceState {
  overview: FinanceOverview | null
  loadingOverview: boolean
  period: PeriodFilter

  /** Per-call failure reason, or null on success. See `errMsg` above. */
  overviewError: string | null
  revenueError: string | null
  expensesError: string | null
  aiUsageError: string | null
  voidedInvoicesError: string | null
  topCompaniesError: string | null

  revenue: RevenueRow[]
  revenueTotal: number
  /** Real-money net total of the WHOLE filtered period (not the page). */
  revenuePeriodTotalMinor: number
  /** Credit face value net total of the whole filtered period. */
  revenuePeriodFaceTotalMinor: number
  revenueFilters: PeriodFilter & {
    type: 'purchase' | 'refund' | null
    /** Adds `adjustment` rows (manual wallet corrections, affiliate rewards)
     *  to the ledger. Off = the backend default (`purchase`+`refund`). */
    includeAdjustments: boolean
    page: number
    pageSize: number
  }
  loadingRevenue: boolean

  voidedInvoices: VoidedInvoiceRow[]
  voidedInvoicesTotal: number
  voidedInvoicesSumMinor: number
  voidedInvoicesPage: number
  loadingVoidedInvoices: boolean
  voidedInvoicesLoaded: boolean

  topCompanies: TopCompanyRow[]
  topCompaniesTotal: number
  topCompaniesSpendMinor: number
  topCompaniesPage: number
  loadingTopCompanies: boolean
  topCompaniesLoaded: boolean

  expenses: ExpenseRow[]
  expensesTotal: number
  expenseFilters: PeriodFilter & { category: ExpenseCategory | null; page: number; pageSize: number }
  loadingExpenses: boolean

  aiUsage: AiUsageReport | null
  loadingAiUsage: boolean

  // Bumped on every `fetchOverview`/`fetchRevenue`/`fetchExpenses` call —
  // each in-flight request is tagged with the value it saw, and discards its
  // own result if a newer call (a fast follow-up filter change) has started
  // in the meantime. Without this, clicking through period/filter options
  // quickly can let a slower, earlier request's response land AFTER a
  // faster, newer one and silently overwrite it with stale data.
  overviewSeq: number
  revenueSeq: number
  expensesSeq: number
}

export const useAdminFinanceStore = defineStore('adminFinance', {
  state: (): AdminFinanceState => ({
    overview: null,
    loadingOverview: false,
    period: { from: null, to: null },

    overviewError: null,
    revenueError: null,
    expensesError: null,
    aiUsageError: null,
    voidedInvoicesError: null,
    topCompaniesError: null,

    revenue: [],
    revenueTotal: 0,
    revenuePeriodTotalMinor: 0,
    revenuePeriodFaceTotalMinor: 0,
    revenueFilters: {
      from: null,
      to: null,
      type: null,
      includeAdjustments: false,
      page: 1,
      pageSize: 20,
    },
    loadingRevenue: false,

    voidedInvoices: [],
    voidedInvoicesTotal: 0,
    voidedInvoicesSumMinor: 0,
    voidedInvoicesPage: 1,
    loadingVoidedInvoices: false,
    voidedInvoicesLoaded: false,

    topCompanies: [],
    topCompaniesTotal: 0,
    topCompaniesSpendMinor: 0,
    topCompaniesPage: 1,
    loadingTopCompanies: false,
    topCompaniesLoaded: false,

    expenses: [],
    expensesTotal: 0,
    expenseFilters: { from: null, to: null, category: null, page: 1, pageSize: 20 },
    loadingExpenses: false,

    aiUsage: null,
    loadingAiUsage: false,

    overviewSeq: 0,
    revenueSeq: 0,
    expensesSeq: 0,
  }),

  actions: {
    setPeriod(from: string | null, to: string | null): void {
      this.period = { from, to }
      void this.fetchOverview()
      // The dashboard's two drill-down tables share the same period, so they
      // must not keep showing the previous one's numbers — but only refresh
      // them once the user has actually opened them.
      if (this.voidedInvoicesLoaded) {
        this.voidedInvoicesPage = 1
        void this.fetchVoidedInvoices()
      }
      if (this.topCompaniesLoaded) {
        this.topCompaniesPage = 1
        void this.fetchTopCompanies()
      }
    },

    /** `from`/`to` of the dashboard period, as query params. */
    periodParams(): URLSearchParams {
      const params = new URLSearchParams()
      if (this.period.from) params.set('from', this.period.from)
      if (this.period.to) params.set('to', this.period.to)
      return params
    },

    async fetchOverview(): Promise<void> {
      const seq = ++this.overviewSeq
      this.loadingOverview = true
      try {
        const params = new URLSearchParams()
        if (this.period.from) params.set('from', this.period.from)
        if (this.period.to) params.set('to', this.period.to)
        const qs = params.toString()
        const res = await apiFetch<FinanceOverview>(`/admin/finance/overview${qs ? `?${qs}` : ''}`)
        if (seq !== this.overviewSeq) return
        this.overview = res
        this.overviewError = null
      } catch (e) {
        // A superseded request's failure must not overwrite the state a
        // still-in-flight newer one is about to fill.
        if (seq === this.overviewSeq) this.overviewError = errMsg(e)
      } finally {
        if (seq === this.overviewSeq) this.loadingOverview = false
      }
    },

    setRevenueFilter<K extends keyof AdminFinanceState['revenueFilters']>(
      key: K,
      value: AdminFinanceState['revenueFilters'][K],
    ): void {
      this.revenueFilters[key] = value
      if (key !== 'page') this.revenueFilters.page = 1
      void this.fetchRevenue()
    },

    /** Shared by the ledger list and its PDF export, so the download can
     *  never cover a different slice than the table on screen. */
    revenueParams(): URLSearchParams {
      const f = this.revenueFilters
      const params = new URLSearchParams()
      if (f.type) params.set('type', f.type)
      else if (f.includeAdjustments) {
        for (const t of ['purchase', 'refund', 'adjustment']) params.append('types', t)
      }
      if (f.from) params.set('from', f.from)
      if (f.to) params.set('to', f.to)
      return params
    },

    async fetchRevenue(): Promise<void> {
      const seq = ++this.revenueSeq
      this.loadingRevenue = true
      try {
        const f = this.revenueFilters
        const params = this.revenueParams()
        params.set('page', String(f.page))
        params.set('pageSize', String(f.pageSize))
        const res = await apiFetch<{
          items: RevenueRow[]
          total: number
          periodTotalMinor: number
          periodFaceTotalMinor: number
        }>(`/admin/finance/revenue?${params.toString()}`)
        if (seq !== this.revenueSeq) return
        this.revenue = res.items
        this.revenueTotal = res.total
        this.revenuePeriodTotalMinor = res.periodTotalMinor
        this.revenuePeriodFaceTotalMinor = res.periodFaceTotalMinor
        this.revenueError = null
      } catch (e) {
        if (seq === this.revenueSeq) this.revenueError = errMsg(e)
      } finally {
        if (seq === this.revenueSeq) this.loadingRevenue = false
      }
    },

    revenueExportUrl(): string {
      const q = this.revenueParams().toString()
      return `${BASE_URL}/admin/finance/revenue/export${q ? `?${q}` : ''}`
    },

    async fetchVoidedInvoices(): Promise<void> {
      this.loadingVoidedInvoices = true
      try {
        const params = this.periodParams()
        params.set('page', String(this.voidedInvoicesPage))
        const res = await apiFetch<{
          items: VoidedInvoiceRow[]
          total: number
          voidedTotalMinor: number
        }>(`/admin/finance/voided-invoices?${params.toString()}`)
        this.voidedInvoices = res.items
        this.voidedInvoicesTotal = res.total
        this.voidedInvoicesSumMinor = res.voidedTotalMinor
        this.voidedInvoicesLoaded = true
        this.voidedInvoicesError = null
      } catch (e) {
        this.voidedInvoicesError = errMsg(e)
      } finally {
        this.loadingVoidedInvoices = false
      }
    },

    setVoidedInvoicesPage(page: number): void {
      this.voidedInvoicesPage = page
      void this.fetchVoidedInvoices()
    },

    async fetchTopCompanies(): Promise<void> {
      this.loadingTopCompanies = true
      try {
        const params = this.periodParams()
        params.set('page', String(this.topCompaniesPage))
        const res = await apiFetch<{
          items: TopCompanyRow[]
          total: number
          totalSpendMinor: number
        }>(`/admin/finance/top-companies?${params.toString()}`)
        this.topCompanies = res.items
        this.topCompaniesTotal = res.total
        this.topCompaniesSpendMinor = res.totalSpendMinor
        this.topCompaniesLoaded = true
        this.topCompaniesError = null
      } catch (e) {
        this.topCompaniesError = errMsg(e)
      } finally {
        this.loadingTopCompanies = false
      }
    },

    setTopCompaniesPage(page: number): void {
      this.topCompaniesPage = page
      void this.fetchTopCompanies()
    },

    setExpenseFilter<K extends keyof AdminFinanceState['expenseFilters']>(
      key: K,
      value: AdminFinanceState['expenseFilters'][K],
    ): void {
      this.expenseFilters[key] = value
      if (key !== 'page') this.expenseFilters.page = 1
      void this.fetchExpenses()
    },

    async fetchExpenses(): Promise<void> {
      const seq = ++this.expensesSeq
      this.loadingExpenses = true
      try {
        const f = this.expenseFilters
        const params = new URLSearchParams()
        if (f.category) params.set('category', f.category)
        if (f.from) params.set('from', f.from)
        if (f.to) params.set('to', f.to)
        params.set('page', String(f.page))
        params.set('pageSize', String(f.pageSize))
        const res = await apiFetch<{ items: ExpenseRow[]; total: number }>(
          `/admin/finance/expenses?${params.toString()}`,
        )
        if (seq !== this.expensesSeq) return
        this.expenses = res.items
        this.expensesTotal = res.total
        this.expensesError = null
      } catch (e) {
        if (seq === this.expensesSeq) this.expensesError = errMsg(e)
      } finally {
        if (seq === this.expensesSeq) this.loadingExpenses = false
      }
    },

    expensesExportUrl(): string {
      const f = this.expenseFilters
      const params = new URLSearchParams()
      if (f.category) params.set('category', f.category)
      if (f.from) params.set('from', f.from)
      if (f.to) params.set('to', f.to)
      const q = params.toString()
      return `${BASE_URL}/admin/finance/expenses/export${q ? `?${q}` : ''}`
    },

    async createExpense(input: {
      category: ExpenseCategory
      incurredOn: string
      amountMinor: number
      currency?: ExpenseCurrency
      note?: string
    }): Promise<void> {
      await apiFetch('/admin/finance/expenses', { method: 'POST', body: input })
      await Promise.all([this.fetchExpenses(), this.fetchOverview()])
    },

    async updateExpense(
      id: string,
      input: Partial<{
        category: ExpenseCategory
        incurredOn: string
        amountMinor: number
        currency: ExpenseCurrency
        note: string
      }>,
    ): Promise<void> {
      await apiFetch(`/admin/finance/expenses/${id}`, { method: 'PATCH', body: input })
      await Promise.all([this.fetchExpenses(), this.fetchOverview()])
    },

    async deleteExpense(id: string): Promise<void> {
      await apiFetch(`/admin/finance/expenses/${id}`, { method: 'DELETE' })
      await Promise.all([this.fetchExpenses(), this.fetchOverview()])
    },

    async fetchAiUsage(): Promise<void> {
      this.loadingAiUsage = true
      try {
        const params = new URLSearchParams()
        if (this.period.from) params.set('from', this.period.from)
        if (this.period.to) params.set('to', this.period.to)
        const qs = params.toString()
        this.aiUsage = await apiFetch<AiUsageReport>(`/admin/finance/ai-usage${qs ? `?${qs}` : ''}`)
        this.aiUsageError = null
      } catch (e) {
        this.aiUsageError = errMsg(e)
      } finally {
        this.loadingAiUsage = false
      }
    },

    aiUsageExportUrl(): string {
      const params = new URLSearchParams()
      if (this.period.from) params.set('from', this.period.from)
      if (this.period.to) params.set('to', this.period.to)
      const q = params.toString()
      return `${BASE_URL}/admin/finance/ai-usage/export${q ? `?${q}` : ''}`
    },
  },
})
