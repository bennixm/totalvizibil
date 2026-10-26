import { defineStore } from 'pinia'

import { apiFetch, BASE_URL } from '@/services/api'

export type ExpenseCategory =
  | 'hosting'
  | 'call_center'
  | 'cloud_storage'
  | 'domains'
  | 'google_ads'
  | 'stripe_fees'
  | 'other'

export interface FinanceOverview {
  range: { from: string; to: string }
  revenueMinor: number
  operatingCostMinor: number
  aiCostMinor: number
  totalCostMinor: number
  profitMinor: number
  expensesByCategory: Record<ExpenseCategory, number>
  paidTraffic: { cpcRevenueMinor: number; adSpendMinor: number; profitMinor: number }
  otherFeesConsumedMinor: number
  trend: { date: string; revenueMinor: number; costMinor: number }[]
}

export interface RevenueRow {
  id: string
  type: 'purchase' | 'refund'
  amountMinor: number
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

  revenue: RevenueRow[]
  revenueTotal: number
  revenueFilters: PeriodFilter & { type: 'purchase' | 'refund' | null; page: number; pageSize: number }
  loadingRevenue: boolean

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

    revenue: [],
    revenueTotal: 0,
    revenueFilters: { from: null, to: null, type: null, page: 1, pageSize: 20 },
    loadingRevenue: false,

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

    async fetchRevenue(): Promise<void> {
      const seq = ++this.revenueSeq
      this.loadingRevenue = true
      try {
        const f = this.revenueFilters
        const params = new URLSearchParams()
        if (f.type) params.set('type', f.type)
        if (f.from) params.set('from', f.from)
        if (f.to) params.set('to', f.to)
        params.set('page', String(f.page))
        params.set('pageSize', String(f.pageSize))
        const res = await apiFetch<{ items: RevenueRow[]; total: number }>(
          `/admin/finance/revenue?${params.toString()}`,
        )
        if (seq !== this.revenueSeq) return
        this.revenue = res.items
        this.revenueTotal = res.total
      } finally {
        if (seq === this.revenueSeq) this.loadingRevenue = false
      }
    },

    revenueExportUrl(): string {
      const f = this.revenueFilters
      const params = new URLSearchParams()
      if (f.type) params.set('type', f.type)
      if (f.from) params.set('from', f.from)
      if (f.to) params.set('to', f.to)
      const q = params.toString()
      return `${BASE_URL}/admin/finance/revenue/export${q ? `?${q}` : ''}`
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
      note?: string
    }): Promise<void> {
      await apiFetch('/admin/finance/expenses', { method: 'POST', body: input })
      await Promise.all([this.fetchExpenses(), this.fetchOverview()])
    },

    async updateExpense(
      id: string,
      input: Partial<{ category: ExpenseCategory; incurredOn: string; amountMinor: number; note: string }>,
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
