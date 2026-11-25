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

/** `from`/`to`/`all` → query params, shared by every finance endpoint that
 *  takes this same period shape — `all` wins over `from`/`to` server-side
 *  (see `FinanceService.resolveRange()`), but both are still sent as-is so
 *  switching back off `all` doesn't require clearing them first. */
function periodFilterParams(f: { from: string | null; to: string | null; all?: boolean }): URLSearchParams {
  const params = new URLSearchParams()
  if (f.from) params.set('from', f.from)
  if (f.to) params.set('to', f.to)
  if (f.all) params.set('all', 'true')
  return params
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
  googleAds: number
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

/** `consumedRevenueRealMoneyMinor`/`totalCostMinor` for an arbitrary range —
 *  the shape behind `FinanceOverview.finalProfit`'s Today/Month/Year trio. */
export interface FinalProfitFigures {
  consumedRevenueRealMoneyMinor: number
  totalCostMinor: number
  profitMinor: number
}

export interface AiBuilderFigures {
  promptRevenueRealMoneyMinor: number
  providerCostMinor: number
  promptProfitMinor: number
  builderUnlockRevenueRealMoneyMinor: number
  totalProfitMinor: number
  /** The Google Ads campaign-management agent's own real Claude spend —
   *  never charged to any customer, so it has no revenue/profit counterpart
   *  the way `providerCostMinor` above does. */
  campaignAgentCostMinor: number
  campaignAgentAvailable: boolean
}

export type ConsumptionCategory = 'cpc' | 'aiUsage' | 'builderUnlock' | 'googleAds' | 'other'
export type ExportFormat = 'pdf' | 'csv' | 'xlsx'

/** What the statement could not compute exactly (mirrors the backend). */
export interface MissingInfo {
  key: 'vatUnknown' | 'expenseFx' | 'aiEstimated' | 'unmatched' | 'forfeit' | 'incomeTax' | 'expenseVat'
  count?: number
  amountMinor?: number
}

/** The financial statement (profit and loss) for a period. All EUR cents.
 *  See the backend's `FinanceStatementService` for how each figure is made. */
export interface FinancialStatement {
  range: { from: string; to: string }
  cash: {
    purchaseCount: number
    collectedMinor: number
    collectedVatMinor: number
    refundCount: number
    refundedMinor: number
    refundedVatMinor: number
    netMinor: number
    netVatMinor: number
    netExVatMinor: number
    vatUnknownMinor: number
    faceValueSoldMinor: number
    discountMinor: number
  }
  revenue: {
    byCategory: Record<ConsumptionCategory, number>
    refundFeesMinor: number
    totalNetMinor: number
    totalVatMinor: number
    totalGrossMinor: number
    vatUnknownGrossMinor: number
  }
  nonCash: {
    freeCreditsConsumedMinor: number
    voidedCreditsConsumedMinor: number
    forfeitedCreditsMinor: number
    forfeitedMoneyMinor: number
    unmatchedCreditsMinor: number
  }
  expenses: {
    byCategory: Record<ExpenseCategory, number>
    ai: { builderMinor: number; campaignAgentMinor: number; googleAdsOptimizerMinor: number; searchMinor: number; totalMinor: number }
    totalMinor: number
    missingFx: { count: number; byCurrency: Record<string, number> }
  }
  result: { operatingProfitMinor: number; cashResultMinor: number; marginPct: number | null }
  missing: MissingInfo[]
}

/** Customer advances (paid credits not consumed yet) at a date. */
export interface BalanceSnapshot {
  asOf: string
  advancesMoneyMinor: number
  advancesVatMinor: number
  advancesNetMinor: number
  advancesVatUnknownMinor: number
  unconsumedPaidCreditsMinor: number
  unconsumedFreeCreditsMinor: number
  unconsumedVoidedCreditsMinor: number
}

export interface DailyPoint {
  date: string
  revenueMinor: number
  expenseMinor: number
  cashNetMinor: number
}

export type CheckSeverity = 'ok' | 'info' | 'warning' | 'error'
export interface CheckItem {
  key:
    | 'duplicatePurchases'
    | 'walletBalance'
    | 'uninvoicedPurchases'
    | 'invoiceMismatch'
    | 'refundSources'
    | 'stripeFeeMissing'
    | 'expenseFx'
    | 'duplicateExpenses'
    | 'unmatchedConsumption'
    | 'forfeitedCredits'
  severity: CheckSeverity
  count: number
  amountMinor: number | null
  samples: { label: string; detail?: string; amountMinor?: number }[]
}

export interface MonthlyReport {
  year: number
  months: FinancialStatement[]
  total: FinancialStatement
}

export interface FinanceOverview {
  range: { from: string; to: string }
  revenueMinor: number
  /** Real money behind credits ALREADY consumed in the period — the actual
   *  basis for `profitMinor` (an unspent credit is still refundable, so
   *  collecting the money for it isn't profit yet). */
  consumedRevenueRealMoneyMinor: number
  /** `revenueMinor` minus the above — money collected for credits still
   *  sitting unconsumed in a wallet. */
  unconsumedRevenueMinor: number
  operatingCostMinor: number
  aiCostMinor: number
  totalCostMinor: number
  profitMinor: number
  /** Always Today/This month/This year (UTC) — independent of the page's
   *  adjustable period filter, like the point-in-time wallet figures below. */
  finalProfit: { today: FinalProfitFigures; month: FinalProfitFigures; year: FinalProfitFigures }
  aiBuilder: AiBuilderFigures
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
  /** The full statement for the period (same figures as the exports). */
  statement: FinancialStatement
  /** Customer advances at the period end. */
  balance: BalanceSnapshot
  daily: DailyPoint[]
}

export type RevenueTxnType = 'purchase' | 'refund' | 'adjustment' | 'spend'
export type TxnStatusFilter = 'completed' | 'pending' | 'processing' | 'failed' | 'canceled' | 'all'
export type TxnSort = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'

export interface RevenueRow {
  id: string
  type: RevenueTxnType
  status: Exclude<TxnStatusFilter, 'all'>
  /** VAT inside a purchase's money, from its invoice (null = no invoice). */
  vatMinor: number | null
  userId: string | null
  invoiceNumber: string | null
  providerRef: string | null
  clickCount: number | null
  category: ConsumptionCategory | null
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
  source: 'manual' | 'stripe_api' | 'google_ads_api'
  note: string | null
  createdBy: { name: string } | null
  /** Units of `currency` per 1 EUR (non-EUR documents). */
  fxRate: number | null
  /** EUR cents every report sums; null = foreign currency without a rate. */
  eurMinor: number | null
}

export interface TypeSubtotal {
  count: number
  amountMinor: number
  moneyMinor: number
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
  /** What the client's wallet was actually charged for this model's usage —
   *  the fixed per-request markup, not a 1:1 pass-through of `costMinor`. */
  chargedMinor: number
}

export interface AiUsageReport {
  range: { from: string; to: string }
  totalCostMinor: number
  totalTokens: number
  totalCalls: number
  byModel: AiUsageModelRow[]
  /** Customers' Google Ads agent (cycles and chat): charged vs AI cost. */
  googleAdsOptimizer?: {
    cycles: number
    chatMessages: number
    aiCostMinor: number
    chargedMinor: number
    aiCalls: number
  }
  /** Homepage "ask" search: how searches were answered + Claude's cost. */
  search?: AiSearchUsage
}

export interface AiSearchUsage {
  searches: number
  /** Reused a stored Claude answer (free). */
  stored: number
  /** A category name was in the text (free). */
  keyword: number
  /** Local embedding model was sure (free). */
  local: number
  /** New Claude call (paid). */
  ai: number
  /** Local best guess (Claude capped / unavailable). */
  guess: number
  costMinor: number
  costUsd: number
  avgCostUsd: number
}

export interface PeriodFilter {
  from: string | null
  to: string | null
  /** "Ignore from/to, show literally every row ever" — see the backend's
   *  `FinanceService.resolveRange()`. Wins over `from`/`to` when set. */
  all?: boolean
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
  /** The resolved range the ledger is actually filtered to right now. */
  revenueRange: { from: string; to: string } | null
  revenueFilters: PeriodFilter & {
    /** Which kinds of rows; default the cash rows (purchases + refunds). */
    types: RevenueTxnType[]
    status: TxnStatusFilter
    /** Free-text search (client, business, invoice, payment ref, id). */
    q: string
    /** Absolute amount bounds in EUR (null = open). */
    minAmount: number | null
    maxAmount: number | null
    sort: TxnSort
    page: number
    pageSize: number
  }
  revenueByType: Record<RevenueTxnType, TypeSubtotal> | null
  loadingRevenue: boolean

  checks: CheckItem[] | null
  checksGeneratedAt: string | null
  loadingChecks: boolean
  checksError: string | null

  monthly: MonthlyReport | null
  loadingMonthly: boolean
  monthlyError: string | null

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
  /** The filter as actually applied — `{from: null, to: null}` means
   *  lifetime (this endpoint's own default when nothing is set). */
  expensesRange: { from: string | null; to: string | null } | null
  /** EUR total of the whole filtered set (rate-less foreign rows excluded). */
  expensesTotalEurMinor: number
  expensesMissingFxCount: number
  loadingExpenses: boolean

  aiUsage: AiUsageReport | null
  // Independent of `period` (the Dashboard's own filter) — this used to
  // silently inherit it instead, so opening Consum AI directly (no visit to
  // the Dashboard first) showed whatever period happened to be left over,
  // with no filter control of its own to change it.
  aiUsageFilters: PeriodFilter
  /** A SEPARATE `overview()` snapshot scoped to `aiUsageFilters` (not the
   *  Dashboard's own `overview`/`period`) — the page's revenue/profit cards
   *  read `aiBuilder` off this, so they can never show a different period
   *  than the cost/calls/tokens figures on the very same page. */
  aiUsageOverview: FinanceOverview | null
  loadingAiUsage: boolean

  // Bumped on every `fetchOverview`/`fetchRevenue`/`fetchExpenses`/
  // `fetchAiUsage` call — each in-flight request is tagged with the value it
  // saw, and discards its own result if a newer call (a fast follow-up
  // filter change) has started in the meantime. Without this, clicking
  // through period/filter options quickly can let a slower, earlier
  // request's response land AFTER a faster, newer one and silently
  // overwrite it with stale data.
  overviewSeq: number
  revenueSeq: number
  expensesSeq: number
  aiUsageSeq: number
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
    revenueRange: null,
    revenueFilters: {
      from: null,
      to: null,
      types: ['purchase', 'refund'],
      status: 'completed',
      q: '',
      minAmount: null,
      maxAmount: null,
      sort: 'date_desc',
      page: 1,
      pageSize: 25,
    },
    revenueByType: null,
    loadingRevenue: false,

    checks: null,
    checksGeneratedAt: null,
    loadingChecks: false,
    checksError: null,

    monthly: null,
    loadingMonthly: false,
    monthlyError: null,

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
    expensesRange: null,
    expensesTotalEurMinor: 0,
    expensesMissingFxCount: 0,
    loadingExpenses: false,

    aiUsage: null,
    aiUsageFilters: { from: null, to: null },
    aiUsageOverview: null,
    loadingAiUsage: false,

    overviewSeq: 0,
    revenueSeq: 0,
    expensesSeq: 0,
    aiUsageSeq: 0,
  }),

  actions: {
    setPeriod(from: string | null, to: string | null, all = false): void {
      this.period = { from, to, all }
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

    /** `from`/`to`/`all` of the dashboard period, as query params. */
    periodParams(): URLSearchParams {
      return periodFilterParams(this.period)
    },

    async fetchOverview(): Promise<void> {
      const seq = ++this.overviewSeq
      this.loadingOverview = true
      try {
        const qs = this.periodParams().toString()
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

    /** Sets from/to/all together (one fetch, not three) — the period-preset
     *  side of the filter bar; `setRevenueFilter` above stays for the
     *  single-field controls (type toggle, adjustments switch, paging). */
    setRevenuePeriod(from: string | null, to: string | null, all = false): void {
      this.revenueFilters.from = from
      this.revenueFilters.to = to
      this.revenueFilters.all = all
      this.revenueFilters.page = 1
      void this.fetchRevenue()
    },

    /** Shared by the ledger list and its PDF export, so the download can
     *  never cover a different slice than the table on screen. */
    revenueParams(): URLSearchParams {
      const f = this.revenueFilters
      const params = periodFilterParams(f)
      for (const t of f.types.length ? f.types : ['purchase', 'refund']) params.append('types', t)
      if (f.status !== 'completed') params.set('status', f.status)
      if (f.q.trim()) params.set('q', f.q.trim())
      if (f.minAmount !== null) params.set('minAmount', String(Math.round(f.minAmount * 100)))
      if (f.maxAmount !== null) params.set('maxAmount', String(Math.round(f.maxAmount * 100)))
      if (f.sort !== 'date_desc') params.set('sort', f.sort)
      return params
    },

    /** Resets every register filter except the period. */
    resetRevenueFilters(): void {
      Object.assign(this.revenueFilters, {
        types: ['purchase', 'refund'],
        status: 'completed',
        q: '',
        minAmount: null,
        maxAmount: null,
        sort: 'date_desc',
        page: 1,
      })
      void this.fetchRevenue()
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
          range: { from: string; to: string }
          periodTotalMinor: number
          periodFaceTotalMinor: number
          byType: Record<RevenueTxnType, TypeSubtotal>
        }>(`/admin/finance/revenue?${params.toString()}`)
        if (seq !== this.revenueSeq) return
        this.revenueByType = res.byType
        this.revenue = res.items
        this.revenueTotal = res.total
        this.revenueRange = res.range
        this.revenuePeriodTotalMinor = res.periodTotalMinor
        this.revenuePeriodFaceTotalMinor = res.periodFaceTotalMinor
        this.revenueError = null
      } catch (e) {
        if (seq === this.revenueSeq) this.revenueError = errMsg(e)
      } finally {
        if (seq === this.revenueSeq) this.loadingRevenue = false
      }
    },

    revenueExportUrl(format: ExportFormat = 'pdf'): string {
      const params = this.revenueParams()
      params.set('format', format)
      return `${BASE_URL}/admin/finance/revenue/export?${params.toString()}`
    },

    /** The financial report (profit and loss) of the dashboard's period, or
     *  the annual report of `year` (12 months + total). */
    reportExportUrl(format: ExportFormat, year?: number): string {
      const params = year ? new URLSearchParams({ year: String(year) }) : this.periodParams()
      params.set('format', format)
      return `${BASE_URL}/admin/finance/report/export?${params.toString()}`
    },

    async fetchChecks(): Promise<void> {
      this.loadingChecks = true
      try {
        const res = await apiFetch<{ generatedAt: string; items: CheckItem[] }>('/admin/finance/checks')
        this.checks = res.items
        this.checksGeneratedAt = res.generatedAt
        this.checksError = null
      } catch (e) {
        this.checksError = errMsg(e)
      } finally {
        this.loadingChecks = false
      }
    },

    async fetchMonthly(year: number): Promise<void> {
      this.loadingMonthly = true
      try {
        this.monthly = await apiFetch<MonthlyReport>(`/admin/finance/report/monthly?year=${year}`)
        this.monthlyError = null
      } catch (e) {
        this.monthlyError = errMsg(e)
      } finally {
        this.loadingMonthly = false
      }
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

    /** Sets from/to/all together (one fetch, not three) — mirrors
     *  `setRevenuePeriod`. */
    setExpensesPeriod(from: string | null, to: string | null, all = false): void {
      this.expenseFilters.from = from
      this.expenseFilters.to = to
      this.expenseFilters.all = all
      this.expenseFilters.page = 1
      void this.fetchExpenses()
    },

    expensesParams(): URLSearchParams {
      const f = this.expenseFilters
      const params = periodFilterParams(f)
      if (f.category) params.set('category', f.category)
      return params
    },

    async fetchExpenses(): Promise<void> {
      const seq = ++this.expensesSeq
      this.loadingExpenses = true
      try {
        const f = this.expenseFilters
        const params = this.expensesParams()
        params.set('page', String(f.page))
        params.set('pageSize', String(f.pageSize))
        const res = await apiFetch<{
          items: ExpenseRow[]
          total: number
          range: { from: string | null; to: string | null }
          totalEurMinor: number
          missingFxCount: number
        }>(`/admin/finance/expenses?${params.toString()}`)
        if (seq !== this.expensesSeq) return
        this.expensesTotalEurMinor = res.totalEurMinor
        this.expensesMissingFxCount = res.missingFxCount
        this.expenses = res.items
        this.expensesTotal = res.total
        this.expensesRange = res.range
        this.expensesError = null
      } catch (e) {
        if (seq === this.expensesSeq) this.expensesError = errMsg(e)
      } finally {
        if (seq === this.expensesSeq) this.loadingExpenses = false
      }
    },

    expensesExportUrl(format: ExportFormat = 'pdf'): string {
      const params = this.expensesParams()
      params.set('format', format)
      return `${BASE_URL}/admin/finance/expenses/export?${params.toString()}`
    },

    async createExpense(input: {
      category: ExpenseCategory
      incurredOn: string
      amountMinor: number
      currency?: ExpenseCurrency
      fxRate?: number
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
        fxRate: number
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

    /** Independent of the Dashboard's `period` — see `aiUsageFilters`'s own doc. */
    setAiUsagePeriod(from: string | null, to: string | null, all = false): void {
      this.aiUsageFilters = { from, to, all }
      void this.fetchAiUsage()
      void this.fetchAiUsageOverview()
    },

    async fetchAiUsage(): Promise<void> {
      const seq = ++this.aiUsageSeq
      this.loadingAiUsage = true
      try {
        const qs = periodFilterParams(this.aiUsageFilters).toString()
        const res = await apiFetch<AiUsageReport>(`/admin/finance/ai-usage${qs ? `?${qs}` : ''}`)
        if (seq !== this.aiUsageSeq) return
        this.aiUsage = res
        this.aiUsageError = null
      } catch (e) {
        if (seq === this.aiUsageSeq) this.aiUsageError = errMsg(e)
      } finally {
        if (seq === this.aiUsageSeq) this.loadingAiUsage = false
      }
    },

    /** `aiBuilder` (revenue/profit) lives on `overview()`, not the
     *  `ai-usage` endpoint — fetched separately, scoped to THIS page's own
     *  `aiUsageFilters`, never the Dashboard's `period` (see
     *  `aiUsageOverview`'s own doc on why those must not be conflated). */
    async fetchAiUsageOverview(): Promise<void> {
      try {
        const qs = periodFilterParams(this.aiUsageFilters).toString()
        this.aiUsageOverview = await apiFetch<FinanceOverview>(
          `/admin/finance/overview${qs ? `?${qs}` : ''}`,
        )
      } catch {
        // Non-fatal: the page's cost/calls/tokens figures (from `aiUsage`)
        // still render without the revenue/profit cards on top.
        this.aiUsageOverview = null
      }
    },

    aiUsageExportUrl(): string {
      const q = periodFilterParams(this.aiUsageFilters).toString()
      return `${BASE_URL}/admin/finance/ai-usage/export${q ? `?${q}` : ''}`
    },
  },
})
