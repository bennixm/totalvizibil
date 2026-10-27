import { defineStore } from 'pinia'

import { apiFetch, ApiError, BASE_URL } from '@/services/api'

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

export interface TicketAttachment {
  id: string
  filename: string
  mime: string
  size: number
}

export interface TicketMessage {
  id: string
  kind: MessageKind
  body: string
  author: { id: string; name: string; staff: boolean } | null
  mine: boolean
  createdAt: string
  attachments: TicketAttachment[]
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
  /** Cursor for the next page of `list`, or null when it's the last one. */
  nextCursor: string | null
  ticket: TicketDetail | null
  overview: SupportOverview | null
  staff: UserMini[]
  loading: boolean
  /** Separate from `loading` so a "load more" spinner never makes the already
   *  rendered list fall back to the full-page loader. */
  loadingMore: boolean
  /** Set only when a "load more" failed — the existing rows stay put, the UI
   *  just says the next page didn't arrive. */
  moreError: boolean
  working: boolean
  error: string
}

/** Bumped on every fresh `loadList` — a response (first page or an appended
 *  one) is only applied while it's still the most recent request, so a slow
 *  page can't land on top of a newer filter set. */
let listToken = 0
/** The filter set the current `list` was built from, replayed by `loadMore`
 *  so the next page is drawn from the same query. */
let listFilters: TicketFilters = {}

function ticketsPath(filters: TicketFilters, cursor?: string | null): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, String(v))
  if (cursor) qs.set('cursor', cursor)
  const q = qs.toString()
  return `/support/tickets${q ? `?${q}` : ''}`
}

/** `nextCursor` is optional on the wire so an older backend (which only ever
 *  returned `items`) still works — it just never offers a next page. */
interface TicketPage {
  items: TicketListItem[]
  nextCursor?: string | null
}

export const useSupportStore = defineStore('support', {
  state: (): State => ({
    list: [],
    nextCursor: null,
    ticket: null,
    overview: null,
    staff: [],
    loading: false,
    loadingMore: false,
    moreError: false,
    working: false,
    error: '',
  }),

  actions: {
    async loadList(filters: TicketFilters = {}): Promise<void> {
      listFilters = { ...filters }
      const token = ++listToken
      this.loading = true
      this.moreError = false
      this.error = ''
      try {
        const res = await apiFetch<TicketPage>(ticketsPath(filters))
        if (token !== listToken) return // a newer loadList() already won
        this.list = res.items
        this.nextCursor = res.nextCursor ?? null
      } catch (err) {
        if (token !== listToken) return
        this.error = err instanceof Error ? err.message : 'error'
      } finally {
        if (token === listToken) this.loading = false
      }
    },

    /** Appends the next page. Never touches `list`/`error` on failure — a
     *  failed "load more" must leave what's already on screen alone. */
    async loadMore(): Promise<void> {
      if (this.loadingMore || !this.nextCursor) return
      const token = listToken
      const cursor = this.nextCursor
      this.loadingMore = true
      this.moreError = false
      try {
        const res = await apiFetch<TicketPage>(ticketsPath(listFilters, cursor))
        if (token !== listToken) return // filters changed while this was in flight
        this.list = [...this.list, ...res.items]
        this.nextCursor = res.nextCursor ?? null
      } catch {
        if (token !== listToken) return
        this.moreError = true
      } finally {
        if (token === listToken) this.loadingMore = false
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

    async reply(
      id: string,
      body: string,
      internal = false,
      attachmentIds: string[] = [],
    ): Promise<boolean> {
      return this.run(() =>
        apiFetch<TicketDetail>(`/support/tickets/${id}/messages`, {
          method: 'POST',
          body: { body, internal, ...(attachmentIds.length ? { attachmentIds } : {}) },
        }),
      )
    },

    /** Upload one file onto the ticket before sending the message that will
     *  reference it — returns the attachment's id (and nothing on failure;
     *  the caller shows its own error, same convention as `uploadAsset`
     *  elsewhere in the app). */
    async uploadAttachment(
      ticketId: string,
      dataUri: string,
      filename: string,
    ): Promise<TicketAttachment | null> {
      this.error = ''
      try {
        return await apiFetch<TicketAttachment>(`/support/tickets/${ticketId}/attachments`, {
          method: 'POST',
          body: { dataUri, filename },
          // A base64 data URI of a multi-MB screenshot regularly outruns the
          // 12s default — the request was being aborted client-side while the
          // server was still happily storing it.
          timeoutMs: 30_000,
        })
      } catch (err) {
        this.error = err instanceof ApiError ? err.message : 'error'
        return null
      }
    },

    attachmentUrl(ticketId: string, attachmentId: string): string {
      return `${BASE_URL}/support/tickets/${ticketId}/attachments/${attachmentId}`
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
