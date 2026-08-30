import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'

export type LeadChannel = 'form' | 'call'
export type LeadStatus = 'new' | 'seen' | 'resolved'

export interface Lead {
  id: string
  channel: LeadChannel
  status: LeadStatus
  name: string | null
  email: string | null
  phone: string | null
  message: string | null
  firstResponseAt: string | null
  resolvedAt: string | null
  responseMinutes: number | null
  createdAt: string
}

export interface LeadsSummary {
  total: number
  new: number
  resolved: number
  form: number
  call: number
  responded: number
  avgResponseMinutes: number | null
}

interface Filters {
  status: '' | LeadStatus
  channel: '' | LeadChannel
}

interface State {
  companyId: string | null
  items: Lead[]
  nextCursor: string | null
  summary: LeadsSummary | null
  filters: Filters
  loading: boolean
  working: boolean
  error: string
}

export const useLeadsStore = defineStore('leads', {
  state: (): State => ({
    companyId: null,
    items: [],
    nextCursor: null,
    summary: null,
    filters: { status: '', channel: '' },
    loading: false,
    working: false,
    error: '',
  }),

  actions: {
    query(): string {
      const p = new URLSearchParams()
      if (this.filters.status) p.set('status', this.filters.status)
      if (this.filters.channel) p.set('channel', this.filters.channel)
      const s = p.toString()
      return s ? `?${s}` : ''
    },

    async load(companyId: string): Promise<void> {
      this.companyId = companyId
      this.loading = true
      this.error = ''
      try {
        const [list, summary] = await Promise.all([
          apiFetch<{ items: Lead[]; nextCursor: string | null }>(
            `/companies/${companyId}/leads${this.query()}`,
          ),
          apiFetch<LeadsSummary>(`/companies/${companyId}/leads/summary`),
        ])
        this.items = list.items
        this.nextCursor = list.nextCursor
        this.summary = summary
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
      } finally {
        this.loading = false
      }
    },

    async setFilter<K extends keyof Filters>(key: K, value: Filters[K]): Promise<void> {
      this.filters[key] = value
      if (this.companyId) await this.load(this.companyId)
    },

    async loadMore(): Promise<void> {
      if (!this.companyId || !this.nextCursor) return
      const q = `${this.query() || '?'}${this.query() ? '&' : ''}cursor=${this.nextCursor}`
      const res = await apiFetch<{ items: Lead[]; nextCursor: string | null }>(
        `/companies/${this.companyId}/leads${q}`,
      )
      this.items = [...this.items, ...res.items]
      this.nextCursor = res.nextCursor
    },

    replace(lead: Lead): void {
      const i = this.items.findIndex((l) => l.id === lead.id)
      if (i >= 0) this.items[i] = lead
    },

    async mutate(leadId: string, body: { status?: LeadStatus; responded?: boolean }): Promise<void> {
      if (!this.companyId) return
      this.working = true
      this.error = ''
      try {
        const lead = await apiFetch<Lead>(`/companies/${this.companyId}/leads/${leadId}`, {
          method: 'PATCH',
          body,
        })
        this.replace(lead)
        this.summary = await apiFetch<LeadsSummary>(
          `/companies/${this.companyId}/leads/summary`,
        )
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
      } finally {
        this.working = false
      }
    },

    markResolved(leadId: string): Promise<void> {
      return this.mutate(leadId, { status: 'resolved' })
    },
    markResponded(leadId: string): Promise<void> {
      return this.mutate(leadId, { responded: true })
    },
    reopen(leadId: string): Promise<void> {
      return this.mutate(leadId, { status: 'new' })
    },

    async remove(leadId: string): Promise<void> {
      if (!this.companyId) return
      this.working = true
      try {
        await apiFetch(`/companies/${this.companyId}/leads/${leadId}`, { method: 'DELETE' })
        this.items = this.items.filter((l) => l.id !== leadId)
        this.summary = await apiFetch<LeadsSummary>(
          `/companies/${this.companyId}/leads/summary`,
        )
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
      } finally {
        this.working = false
      }
    },

    reset(): void {
      this.$reset()
    },
  },
})
