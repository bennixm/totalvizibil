import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'

export type TicketStatus = 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed'
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'
export type TicketCategory =
  | 'bug'
  | 'problem'
  | 'question'
  | 'billing'
  | 'feedback'
  | 'other'
export type MessageKind = 'reply' | 'note' | 'system'

export const TICKET_STATUSES: TicketStatus[] = [
  'open',
  'in_progress',
  'waiting',
  'resolved',
  'closed',
]
export const TICKET_PRIORITIES: TicketPriority[] = ['low', 'normal', 'high', 'urgent']
export const TICKET_CATEGORIES: TicketCategory[] = [
  'bug',
  'problem',
  'question',
  'billing',
  'feedback',
  'other',
]

interface UserMini {
  id: string
  name: string
}

export interface TicketListItem {
  id: string
  number: number
  subject: string
  status: TicketStatus
  priority: TicketPriority
  category: TicketCategory
  requester: UserMini
  assignee: UserMini | null
  company: { id: string; name: string } | null
  messageCount: number
  createdAt: string
  lastActivityAt: string
}

export interface TicketMessage {
  id: string
  kind: MessageKind
  body: string
  author: { id: string; name: string; staff: boolean } | null
  mine: boolean
  createdAt: string
}

export interface TicketDetail {
  id: string
  number: number
  subject: string
  status: TicketStatus
  priority: TicketPriority
  category: TicketCategory
  requester: UserMini
  assignee: UserMini | null
  company: { id: string; name: string } | null
  firstResponseAt: string | null
  resolvedAt: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
  lastActivityAt: string
  messages: TicketMessage[]
  viewerIsStaff: boolean
  viewerIsRequester: boolean
}

export interface SupportOverview {
  open: number
  unassigned: number
  urgent: number
  resolvedToday: number
}

export interface CreateTicketInput {
  subject: string
  body: string
  category: TicketCategory
  priority?: TicketPriority
  companyId?: string
}

export interface TicketFilters {
  scope?: 'mine' | 'all'
  status?: TicketStatus | ''
  priority?: TicketPriority | ''
  assignee?: 'me' | 'unassigned' | ''
  q?: string
}

interface State {
  list: TicketListItem[]
  ticket: TicketDetail | null
  overview: SupportOverview | null
  staff: UserMini[]
  loading: boolean
  working: boolean
  error: string
}

export const useSupportStore = defineStore('support', {
  state: (): State => ({
    list: [],
    ticket: null,
    overview: null,
    staff: [],
    loading: false,
    working: false,
    error: '',
  }),

  actions: {
    async loadList(filters: TicketFilters = {}): Promise<void> {
      this.loading = true
      this.error = ''
      try {
        const qs = new URLSearchParams()
        for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, String(v))
        const q = qs.toString()
        const res = await apiFetch<{ items: TicketListItem[] }>(
          `/support/tickets${q ? `?${q}` : ''}`,
        )
        this.list = res.items
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
      } finally {
        this.loading = false
      }
    },

    async loadOverview(): Promise<void> {
      try {
        this.overview = await apiFetch<SupportOverview>('/support/overview')
      } catch {
        this.overview = null
      }
    },

    async loadStaff(): Promise<void> {
      try {
        const res = await apiFetch<{ staff: UserMini[] }>('/support/staff')
        this.staff = res.staff
      } catch {
        this.staff = []
      }
    },

    async loadTicket(id: string): Promise<void> {
      this.loading = true
      this.error = ''
      try {
        this.ticket = await apiFetch<TicketDetail>(`/support/tickets/${id}`)
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
        this.ticket = null
      } finally {
        this.loading = false
      }
    },

    async create(input: CreateTicketInput): Promise<TicketDetail | null> {
      this.working = true
      this.error = ''
      try {
        const ticket = await apiFetch<TicketDetail>('/support/tickets', {
          method: 'POST',
          body: input,
        })
        this.ticket = ticket
        return ticket
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
        return null
      } finally {
        this.working = false
      }
    },

    async reply(id: string, body: string, internal = false): Promise<boolean> {
      return this.run(() =>
        apiFetch<TicketDetail>(`/support/tickets/${id}/messages`, {
          method: 'POST',
          body: { body, internal },
        }),
      )
    },

    async patch(
      id: string,
      body: Partial<{
        status: TicketStatus
        priority: TicketPriority
        category: TicketCategory
        assigneeId: string
      }>,
    ): Promise<boolean> {
      return this.run(() =>
        apiFetch<TicketDetail>(`/support/tickets/${id}`, { method: 'PATCH', body }),
      )
    },

    async run(fn: () => Promise<TicketDetail>): Promise<boolean> {
      this.working = true
      this.error = ''
      try {
        this.ticket = await fn()
        return true
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
        return false
      } finally {
        this.working = false
      }
    },
  },
})
