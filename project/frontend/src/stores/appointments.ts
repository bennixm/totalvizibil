import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'

export type AppointmentStatus = 'pending' | 'confirmed' | 'canceled' | 'completed'

export interface Appointment {
  id: string
  status: AppointmentStatus
  startsAt: string
  durationMinutes: number
  name: string
  email: string | null
  phone: string | null
  notes: string | null
  createdAt: string
}

export interface AppointmentsSummary {
  total: number
  pending: number
  confirmed: number
  canceled: number
  completed: number
  upcoming: number
}

export interface AvailabilityWindow {
  id?: string
  weekday: number
  startMinute: number
  endMinute: number
}

export interface AppointmentSettings {
  enabled: boolean
  slotMinutes: number
  windows: AvailabilityWindow[]
}

interface Filters {
  status: '' | AppointmentStatus
  upcomingOnly: boolean
}

interface State {
  companyId: string | null
  items: Appointment[]
  nextCursor: string | null
  summary: AppointmentsSummary | null
  settings: AppointmentSettings | null
  filters: Filters
  loading: boolean
  working: boolean
  error: string
}

export const useAppointmentsStore = defineStore('appointments', {
  state: (): State => ({
    companyId: null,
    items: [],
    nextCursor: null,
    summary: null,
    settings: null,
    filters: { status: '', upcomingOnly: true },
    loading: false,
    working: false,
    error: '',
  }),

  actions: {
    query(): string {
      const p = new URLSearchParams()
      if (this.filters.status) p.set('status', this.filters.status)
      if (this.filters.upcomingOnly) p.set('upcomingOnly', 'true')
      const s = p.toString()
      return s ? `?${s}` : ''
    },

    async load(companyId: string): Promise<void> {
      this.companyId = companyId
      this.loading = true
      this.error = ''
      try {
        const [list, summary, settings] = await Promise.all([
          apiFetch<{ items: Appointment[]; nextCursor: string | null }>(
            `/companies/${companyId}/appointments${this.query()}`,
          ),
          apiFetch<AppointmentsSummary>(`/companies/${companyId}/appointments/summary`),
          apiFetch<AppointmentSettings>(`/companies/${companyId}/appointments/settings`),
        ])
        this.items = list.items
        this.nextCursor = list.nextCursor
        this.summary = summary
        this.settings = settings
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
      const res = await apiFetch<{ items: Appointment[]; nextCursor: string | null }>(
        `/companies/${this.companyId}/appointments${q}`,
      )
      this.items = [...this.items, ...res.items]
      this.nextCursor = res.nextCursor
    },

    replace(appt: Appointment): void {
      const i = this.items.findIndex((a) => a.id === appt.id)
      if (i >= 0) this.items[i] = appt
    },

    async updateStatus(id: string, status: AppointmentStatus): Promise<void> {
      if (!this.companyId) return
      this.working = true
      this.error = ''
      try {
        const appt = await apiFetch<Appointment>(
          `/companies/${this.companyId}/appointments/${id}`,
          { method: 'PATCH', body: { status } },
        )
        this.replace(appt)
        this.summary = await apiFetch<AppointmentsSummary>(
          `/companies/${this.companyId}/appointments/summary`,
        )
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
      } finally {
        this.working = false
      }
    },
    confirm(id: string): Promise<void> {
      return this.updateStatus(id, 'confirmed')
    },
    cancel(id: string): Promise<void> {
      return this.updateStatus(id, 'canceled')
    },
    complete(id: string): Promise<void> {
      return this.updateStatus(id, 'completed')
    },

    async remove(id: string): Promise<void> {
      if (!this.companyId) return
      this.working = true
      try {
        await apiFetch(`/companies/${this.companyId}/appointments/${id}`, { method: 'DELETE' })
        this.items = this.items.filter((a) => a.id !== id)
        this.summary = await apiFetch<AppointmentsSummary>(
          `/companies/${this.companyId}/appointments/summary`,
        )
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
      } finally {
        this.working = false
      }
    },

    async saveSettings(patch: { enabled?: boolean; slotMinutes?: number }): Promise<void> {
      if (!this.companyId) return
      this.working = true
      this.error = ''
      try {
        this.settings = await apiFetch<AppointmentSettings>(
          `/companies/${this.companyId}/appointments/settings`,
          { method: 'PUT', body: patch },
        )
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
      } finally {
        this.working = false
      }
    },

    async saveAvailability(windows: AvailabilityWindow[]): Promise<void> {
      if (!this.companyId) return
      this.working = true
      this.error = ''
      try {
        // The backend replaces the whole weekly template in one call and
        // never reads a per-window id — strip it (present on windows loaded
        // from settings) so the strict-whitelist validator doesn't reject
        // the request for an unrecognized field.
        const payload = windows.map(({ weekday, startMinute, endMinute }) => ({
          weekday,
          startMinute,
          endMinute,
        }))
        this.settings = await apiFetch<AppointmentSettings>(
          `/companies/${this.companyId}/appointments/availability`,
          { method: 'PUT', body: { windows: payload } },
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
