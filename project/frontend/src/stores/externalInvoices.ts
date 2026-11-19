import { defineStore } from 'pinia'

import { apiFetch, ApiError, BASE_URL } from '@/services/api'
import { useMoneyStore } from '@/stores/money'

/** Platform display currency (top-nav toggle) every amount is converted to. */
function display(): 'EUR' | 'RON' {
  return useMoneyStore().currency
}

/** Supplier invoices: the original documents our own providers bill us
 *  with (Google Ads, Anthropic, DeepSeek, Stripe, hosting, …). All provider
 *  and AI calls happen server-side; this store only talks to our backend. */

export type ExternalInvoiceProviderKey = 'google_ads' | 'anthropic' | 'deepseek' | 'stripe' | 'other'
export type InvoiceSource = 'api' | 'manual' | 'email' | 'efactura' | 'peppol'
export type ProcessingStatus = 'needs_review' | 'verified'
export type PaymentStatus = 'paid' | 'unpaid' | null
export type ValidationIssue =
  | 'total_mismatch'
  | 'vat_lines_mismatch'
  | 'lines_mismatch'
  | 'due_before_issue'
  | 'period_inverted'
  | 'issue_in_future'
  | 'paid_without_date'
  | 'missing_invoice_number'

/** A document amount converted to a display currency at the BNR rate of its
 *  issue date. */
export interface FxConversion {
  currency: 'EUR' | 'RON'
  subtotalMinor: number | null
  taxMinor: number | null
  totalMinor: number
  /** Display-currency units per 1 unit of the document currency. */
  rate: number
  rateDate: string | null
}

export type InvoiceFlag = 'amount_anomaly' | 'vat_id_changed' | 'due_from_terms'

export interface SupplierRow {
  id: string
  provider: ExternalInvoiceProviderKey
  name: string
  vatId: string | null
  email: string | null
  paymentTermsDays: number | null
  defaultCurrency: string | null
  notes: string | null
  invoiceCount: number
  totals: { currency: string; count: number; totalMinor: number; taxMinor: number }[]
  unpaidCount: number
  lastIssueDate: string | null
  recurring: {
    usualDay: number
    avgMinor: number
    currency: string
    months: number
    missingThisMonth: boolean
    expectedBy: string
  } | null
}

export interface InvoiceInsights {
  recurringCount: number
  missingRecurring: {
    supplier: { id: string; name: string; provider: string }
    usualDay: number
    avgMinor: number
    currency: string
    expectedBy: string
  }[]
  anomalies: {
    id: string
    invoiceNumber: string | null
    issueDate: string
    totalMinor: number
    currency: string
    flags: InvoiceFlag[]
    supplierName: string | null
  }[]
}

export interface CalendarItem {
  id: string
  supplierName: string
  invoiceNumber: string | null
  dueDate: string
  totalMinor: number
  currency: string
  paymentStatus: PaymentStatus
  overdue: boolean
}

export interface VatPeriod {
  period: string
  currency: string
  invoices: number
  unverified: number
  estimated: {
    /** null = no invoice in the period stated it (not the same as 0). */
    netMinor: number | null
    vatMinor: number | null
    totalMinor: number
    byRate: { rate: number | null; netMinor: number; vatMinor: number }[]
  }
  confirmed: {
    vatMinor: number
    enteredMinor: number
    enteredCurrency: string
    note: string | null
    by: string | null
    at: string
  } | null
  differenceMinor: number | null
}

export interface ExternalInvoiceProvider {
  key: ExternalInvoiceProviderKey
  name: string
  automated: boolean
  portalUrl: string | null
  configured: boolean | null
  invoiceCount: number
  documentCount: number
  lastSync: {
    at: string
    ok: boolean
    message: string | null
    imported: number
    updated: number
    documents: number
  } | null
}

export interface VatLine {
  rate: number | null
  netMinor: number
  vatMinor: number
}
export interface InvoiceLine {
  description: string
  quantity: number | null
  unitPriceMinor: number | null
  netMinor: number | null
  vatRate: number | null
}

export interface ExternalInvoice {
  id: string
  provider: ExternalInvoiceProviderKey
  providerName: string
  source: InvoiceSource
  externalId: string | null
  invoiceNumber: string | null
  docType: string | null
  supplierVatId: string | null
  issueDate: string
  dueDate: string | null
  periodStart: string | null
  periodEnd: string | null
  currency: string
  subtotalMinor: number | null
  taxMinor: number | null
  totalMinor: number
  paymentStatus: PaymentStatus
  paidAt: string | null
  processingStatus: ProcessingStatus
  possibleDuplicateOfId: string | null
  supplierId: string | null
  flags: InvoiceFlag[]
  dueState: 'overdue' | 'due_soon' | null
  fx: { EUR: FxConversion | null; RON: FxConversion | null }
  issues: ValidationIssue[]
  note: string | null
  document: { filename: string; mime: string; size: number } | null
  documentError: string | null
  attachmentCount: number
  createdAt: string
}

export interface InvoiceEvent {
  id: string
  kind: string
  message: string | null
  changes: Record<string, { from: unknown; to: unknown }> | Record<string, unknown> | null
  actorName: string | null
  createdAt: string
}

export interface ExternalInvoiceDetail extends ExternalInvoice {
  vatLines: VatLine[]
  lines: InvoiceLine[]
  extraction: {
    engine: string
    model: string
    confidence: number
    fieldConfidence?: Record<string, number>
    estimatedCostUsd?: number
    at?: string
  } | null
  createdByName: string | null
  updatedAt: string
  possibleDuplicateOf: {
    id: string
    invoiceNumber: string | null
    issueDate: string
    totalMinor: number
    currency: string
  } | null
  correctedFields: string[]
  attachments: {
    id: string
    filename: string
    mime: string
    size: number
    createdAt: string
    uploadedByName: string | null
  }[]
  events: InvoiceEvent[]
}

interface MoneyRow {
  currency: string
  count: number
  totalMinor: number
}
export interface InvoiceSummary {
  month: {
    from: string
    to: string
    count: number
    totals: (MoneyRow & { taxMinor: number; subtotalMinor: number })[]
    vatByRate: { currency: string; rate: number | null; netMinor: number; vatMinor: number }[]
    sources: { automated: number; manual: number }
  }
  unpaid: { count: number; totals: MoneyRow[]; unknownPayment: number }
  dueSoon: { count: number; totals: MoneyRow[]; days: number }
  overdue: { count: number; totals: MoneyRow[] }
  needsReview: number
  sources: { automated: number; manual: number }
}

export type SortField = 'issueDate' | 'dueDate' | 'totalMinor' | 'provider' | 'invoiceNumber'

export interface ExternalInvoiceFilters {
  provider: ExternalInvoiceProviderKey | null
  from: string | null
  to: string | null
  q: string
  payment: 'paid' | 'unpaid' | 'unknown' | null
  processing: ProcessingStatus | null
  currency: string | null
  due: 'overdue' | 'due_soon' | null
  source: InvoiceSource | null
  supplierId: string | null
  sortField: SortField
  sortDir: 'asc' | 'desc'
  page: number
  pageSize: number
}

export interface UploadExternalInvoiceInput {
  provider: ExternalInvoiceProviderKey
  providerName?: string
  invoiceNumber: string
  supplierVatId?: string
  issueDate: string
  dueDate?: string
  periodStart?: string
  periodEnd?: string
  currency: string
  subtotalMinor?: number
  taxMinor?: number
  totalMinor: number
  vatLines?: VatLine[]
  lines?: InvoiceLine[]
  paymentStatus?: 'paid' | 'unpaid'
  paidAt?: string
  note?: string
  reviewed?: boolean
  extraction?: {
    engine: string
    model: string
    confidence: number
    fieldConfidence?: Record<string, number>
    estimatedCostUsd?: number
  }
  dataUri: string
  filename: string
}

export interface ExtractionResult {
  draft: {
    supplierName: string | null
    supplierVatId: string | null
    invoiceNumber: string | null
    documentType: string | null
    issueDate: string | null
    dueDate: string | null
    periodStart: string | null
    periodEnd: string | null
    currency: string | null
    subtotalMinor: number | null
    taxMinor: number | null
    totalMinor: number | null
    paymentStatus: 'paid' | 'unpaid' | null
    vatLines: VatLine[]
    lines: InvoiceLine[]
  }
  issues: ValidationIssue[]
  extraction: {
    engine: string
    model: string
    confidence: number
    fieldConfidence: Record<string, number>
    estimatedCostUsd: number
    lowConfidence: boolean
  }
}

export type BulkAction = 'mark_paid' | 'mark_unpaid' | 'mark_verified' | 'mark_needs_review'

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return 'request failed'
}

const PATH = '/admin/finance/external-invoices'

const DEFAULT_FILTERS: Omit<ExternalInvoiceFilters, 'pageSize'> = {
  provider: null,
  from: null,
  to: null,
  q: '',
  payment: null,
  processing: null,
  currency: null,
  due: null,
  source: null,
  supplierId: null,
  sortField: 'issueDate',
  sortDir: 'desc',
  page: 1,
}

export const useExternalInvoicesStore = defineStore('externalInvoices', {
  state: () => ({
    providers: [] as ExternalInvoiceProvider[],
    providersError: null as string | null,
    summary: null as InvoiceSummary | null,
    insights: null as InvoiceInsights | null,
    summaryError: null as string | null,
    items: [] as ExternalInvoice[],
    total: 0,
    totalsByCurrency: [] as { currency: string; count: number; totalMinor: number; taxMinor: number }[],
    years: [] as number[],
    currencies: [] as string[],
    loading: false,
    loaded: false,
    error: null as string | null,
    seq: 0,
    filters: { ...DEFAULT_FILTERS, pageSize: 25 } as ExternalInvoiceFilters,
  }),

  getters: {
    /** How many narrowing filters are on (period and sort don't count). */
    activeFilterCount(state): number {
      const f = state.filters
      return [f.provider, f.payment, f.processing, f.currency, f.due, f.source, f.supplierId, f.q.trim() || null].filter(
        (v) => v !== null && v !== '',
      ).length
    },
  },

  actions: {
    filterParams(): URLSearchParams {
      const f = this.filters
      const p = new URLSearchParams()
      if (f.provider) p.set('provider', f.provider)
      if (f.from) p.set('from', f.from)
      if (f.to) p.set('to', f.to)
      if (f.q.trim()) p.set('q', f.q.trim())
      if (f.payment) p.set('payment', f.payment)
      if (f.processing) p.set('processing', f.processing)
      if (f.currency) p.set('currency', f.currency)
      if (f.due) p.set('due', f.due)
      if (f.source) p.set('source', f.source)
      if (f.supplierId) p.set('supplierId', f.supplierId)
      p.set('sort', `${f.sortField}:${f.sortDir}`)
      p.set('display', display())
      return p
    },

    async loadProviders(): Promise<void> {
      try {
        this.providers = await apiFetch<ExternalInvoiceProvider[]>(`${PATH}/providers`)
        this.providersError = null
      } catch (e) {
        this.providersError = errMsg(e)
      }
    },

    async loadSummary(): Promise<void> {
      try {
        this.summary = await apiFetch<InvoiceSummary>(`${PATH}/summary?display=${display()}`)
        this.summaryError = null
      } catch (e) {
        this.summaryError = errMsg(e)
      }
    },

    async load(): Promise<void> {
      const seq = ++this.seq
      this.loading = true
      const params = this.filterParams()
      params.set('page', String(this.filters.page))
      params.set('pageSize', String(this.filters.pageSize))
      try {
        const res = await apiFetch<{
          items: ExternalInvoice[]
          total: number
          totalsByCurrency: { currency: string; count: number; totalMinor: number; taxMinor: number }[]
          years: number[]
          currencies: string[]
        }>(`${PATH}?${params.toString()}`)
        if (seq !== this.seq) return
        this.items = res.items
        this.total = res.total
        this.totalsByCurrency = res.totalsByCurrency
        this.years = res.years
        this.currencies = res.currencies
        this.error = null
      } catch (e) {
        if (seq === this.seq) this.error = errMsg(e)
      } finally {
        if (seq === this.seq) {
          this.loading = false
          this.loaded = true
        }
      }
    },

    /** Everything on the page (after a write). */
    async refresh(): Promise<void> {
      await Promise.all([this.loadProviders(), this.loadSummary(), this.load(), this.loadInsights()])
    },

    setFilter<K extends keyof ExternalInvoiceFilters>(key: K, value: ExternalInvoiceFilters[K]): void {
      this.filters[key] = value
      if (key !== 'page') this.filters.page = 1
      void this.load()
    },

    /** Several filters at once (e.g. a dashboard card), one request. */
    applyFilters(patch: Partial<ExternalInvoiceFilters>): void {
      Object.assign(this.filters, patch, { page: 1 })
      void this.load()
    },

    setPeriod(from: string | null, to: string | null): void {
      this.filters.from = from
      this.filters.to = to
      this.filters.page = 1
      void this.load()
    },

    toggleSort(field: SortField): void {
      if (this.filters.sortField === field) {
        this.filters.sortDir = this.filters.sortDir === 'asc' ? 'desc' : 'asc'
      } else {
        this.filters.sortField = field
        this.filters.sortDir = field === 'provider' || field === 'invoiceNumber' ? 'asc' : 'desc'
      }
      this.filters.page = 1
      void this.load()
    },

    /** Clears the narrowing filters; keeps the period and sort. */
    resetFilters(): void {
      Object.assign(this.filters, {
        provider: null,
        q: '',
        payment: null,
        processing: null,
        currency: null,
        due: null,
        source: null,
        supplierId: null,
        page: 1,
      })
      void this.load()
    },

    documentUrl(id: string, inline = false): string {
      return `${BASE_URL}${PATH}/${id}/document${inline ? '?inline=1' : ''}`
    },
    attachmentUrl(id: string, attachmentId: string, inline = false): string {
      return `${BASE_URL}${PATH}/${id}/attachments/${attachmentId}${inline ? '?inline=1' : ''}`
    },
    exportUrl(format: 'csv' | 'xlsx'): string {
      const p = this.filterParams()
      p.set('format', format)
      return `${BASE_URL}${PATH}/export?${p.toString()}`
    },

    async fetchDetail(id: string): Promise<ExternalInvoiceDetail> {
      return apiFetch<ExternalInvoiceDetail>(`${PATH}/${id}`)
    },

    /** POST → ZIP blob → browser download. `filters: true` = the current
     *  list filters; otherwise explicit ids or `all`. */
    async downloadZip(scope: { ids?: string[]; all?: boolean; filters?: boolean }): Promise<void> {
      const body: Record<string, unknown> = {}
      if (scope.ids) body.ids = scope.ids
      if (scope.all) body.all = true
      if (scope.filters) {
        for (const [k, v] of this.filterParams().entries()) if (k !== 'sort' && k !== 'display') body[k] = v
      }
      const res = await fetch(`${BASE_URL}${PATH}/zip`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { message?: string } | null
        throw new ApiError(res.status, b?.message ?? `API ${res.status}`, b)
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? 'facturi-furnizori.zip'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    },

    async sync(provider: 'google_ads') {
      const res = await apiFetch<{
        ok: boolean
        message: string | null
        imported: number
        updated: number
        documents: number
      }>(`${PATH}/sync`, { method: 'POST', body: { provider }, timeoutMs: 180_000 })
      await this.refresh()
      return res
    },

    async extract(dataUri: string, filename: string): Promise<ExtractionResult> {
      return apiFetch<ExtractionResult>(`${PATH}/extract`, {
        method: 'POST',
        body: { dataUri, filename },
        timeoutMs: 150_000,
      })
    },

    async upload(input: UploadExternalInvoiceInput): Promise<{ id: string; possibleDuplicateOfId: string | null }> {
      const res = await apiFetch<{ id: string; possibleDuplicateOfId: string | null }>(PATH, {
        method: 'POST',
        body: input,
        timeoutMs: 60_000,
      })
      await this.refresh()
      return res
    },

    async update(id: string, patch: Record<string, unknown>): Promise<ExternalInvoiceDetail> {
      const res = await apiFetch<ExternalInvoiceDetail>(`${PATH}/${id}`, { method: 'PATCH', body: patch })
      void this.loadSummary()
      void this.load()
      return res
    },

    async bulk(ids: string[], action: BulkAction): Promise<{ matched: number; changed: number }> {
      const res = await apiFetch<{ matched: number; changed: number }>(`${PATH}/bulk`, {
        method: 'POST',
        body: { ids, action },
      })
      void this.loadSummary()
      void this.load()
      return res
    },

    async addNote(id: string, text: string): Promise<void> {
      await apiFetch(`${PATH}/${id}/notes`, { method: 'POST', body: { text } })
    },

    async addAttachment(id: string, dataUri: string, filename: string): Promise<void> {
      await apiFetch(`${PATH}/${id}/attachments`, {
        method: 'POST',
        body: { dataUri, filename },
        timeoutMs: 60_000,
      })
      void this.load()
    },

    async removeAttachment(id: string, attachmentId: string): Promise<void> {
      await apiFetch(`${PATH}/${id}/attachments/${attachmentId}`, { method: 'DELETE' })
      void this.load()
    },

    async loadInsights(): Promise<void> {
      try {
        this.insights = await apiFetch<InvoiceInsights>(`${PATH}/insights?display=${display()}`)
      } catch {
        this.insights = null
      }
    },

    async fetchSuppliers(): Promise<SupplierRow[]> {
      return apiFetch<SupplierRow[]>(`${PATH}/suppliers?display=${display()}`)
    },

    async updateSupplier(id: string, patch: Record<string, unknown>): Promise<void> {
      await apiFetch(`${PATH}/suppliers/${id}`, { method: 'PATCH', body: patch })
    },

    async removeSupplier(id: string): Promise<void> {
      await apiFetch(`${PATH}/suppliers/${id}`, { method: 'DELETE' })
    },

    async fetchCalendar(month: string): Promise<{ month: string; items: CalendarItem[] }> {
      return apiFetch(`${PATH}/calendar?month=${encodeURIComponent(month)}&display=${display()}`)
    },

    async fetchVatReport(year: number): Promise<{ year: number; years: number[]; periods: VatPeriod[] }> {
      return apiFetch(`${PATH}/vat-report?year=${year}&display=${display()}`)
    },

    async confirmVat(body: { period: string; currency: string; confirmedVatMinor: number; note?: string }) {
      await apiFetch(`${PATH}/vat-report/confirm`, { method: 'PUT', body })
    },

    async unconfirmVat(period: string, currency: string): Promise<void> {
      await apiFetch(`${PATH}/vat-report/confirm/${period}/${currency}`, { method: 'DELETE' })
    },

    async remove(id: string): Promise<void> {
      await apiFetch(`${PATH}/${id}`, { method: 'DELETE' })
      await this.refresh()
    },
  },
})
