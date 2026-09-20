import { defineStore } from 'pinia'
import { io, type Socket } from 'socket.io-client'
import type { RouteLocationRaw } from 'vue-router'

import { apiFetch, BASE_URL } from '@/services/api'
import { useToastStore, type ToastKind } from '@/stores/toast'
import { i18n } from '@/plugins/i18n'

export interface NotificationItem {
  id: string
  type: string
  title: string
  body: string
  data: Record<string, unknown> | null
  createdAt: string
  readAt: string | null
}

/** One socket message for a brand-new notification (per-user push only —
 *  see `routeForNotification`'s note on why a broadcast has no `id`). */
type SocketNotification = Partial<NotificationItem> & { title: string; body: string }
/** The OTHER socket channel: state a different tab/device already changed
 *  (read / read-all / dismissed) — never a new item, so it's a separate
 *  event name the client can't confuse with the one above. */
type SocketSync = { kind: 'read' | 'read-all' | 'dismissed'; id?: string }

const COMPANY_TYPES = new Set([
  'lead_received',
  'business_created',
  'business_deletion_scheduled',
  'business_deletion_canceled',
  'business_deletion_reminder',
  'business_suspended',
  'business_reactivated',
  'campaign_depleted',
  'wallet_low_balance',
  'campaign_activated',
  'campaign_paused_on_edit',
])
const WALLET_TYPES = new Set([
  'refund_requested',
  'refund_completed',
  'refund_failed',
  'discount_updated',
  'discount_ended',
  'wallet_blocked',
  'wallet_unblocked',
  'wallet_adjusted',
])
const TICKET_TYPES = new Set(['ticket_created', 'ticket_reply', 'ticket_assigned', 'support_ticket_update'])

/** Where clicking a notification should take the user — `null` when there's
 *  nowhere to go (a broadcast, or an email-only type that never really
 *  surfaces here anyway). */
export function routeForNotification(n: Pick<NotificationItem, 'type' | 'data'>): RouteLocationRaw | null {
  const companyId = n.data?.companyId
  const invoiceId = n.data?.invoiceId
  const ticketId = n.data?.ticketId

  if (n.type === 'lead_received' && typeof companyId === 'string') {
    return { name: 'leads', query: { c: companyId } }
  }
  if (COMPANY_TYPES.has(n.type) && typeof companyId === 'string') {
    return { name: 'dashboard', query: { c: companyId } }
  }
  if (n.type === 'pro_build_failed' && typeof companyId === 'string') {
    return { name: 'website-builder', query: { c: companyId } }
  }
  if (n.type === 'payment_succeeded' && typeof invoiceId === 'string') {
    return { name: 'invoice-print', params: { id: invoiceId } }
  }
  if ((n.type === 'invoice_voided' || n.type === 'invoice_restored') && typeof invoiceId === 'string') {
    return { name: 'invoice-print', params: { id: invoiceId } }
  }
  if (WALLET_TYPES.has(n.type)) {
    return { name: 'wallet' }
  }
  if (TICKET_TYPES.has(n.type) && typeof ticketId === 'string') {
    return { name: 'support-ticket', params: { id: ticketId } }
  }
  return null
}

/** Visual family per notification type — one small lookup instead of a big
 *  switch scattered across components, same shape as `routeForNotification`.
 *  `tone` drives both the panel row's icon color AND the pop-up toast kind. */
export type NotificationTone = 'primary' | 'success' | 'warning' | 'error'
export interface NotificationVisual {
  icon: string
  tone: NotificationTone
}

const VISUALS: Record<string, NotificationVisual> = {
  lead_received: { icon: 'mdi-inbox-arrow-down-outline', tone: 'primary' },
  business_created: { icon: 'mdi-domain', tone: 'success' },
  business_deletion_scheduled: { icon: 'mdi-domain-off', tone: 'warning' },
  business_deletion_reminder: { icon: 'mdi-alert-outline', tone: 'warning' },
  business_deletion_canceled: { icon: 'mdi-domain', tone: 'success' },
  business_suspended: { icon: 'mdi-domain-off', tone: 'error' },
  business_reactivated: { icon: 'mdi-domain', tone: 'success' },
  campaign_activated: { icon: 'mdi-bullhorn-outline', tone: 'success' },
  campaign_paused_on_edit: { icon: 'mdi-pause-circle-outline', tone: 'warning' },
  campaign_depleted: { icon: 'mdi-battery-alert-variant-outline', tone: 'warning' },
  wallet_low_balance: { icon: 'mdi-wallet-outline', tone: 'warning' },
  payment_succeeded: { icon: 'mdi-check-decagram-outline', tone: 'success' },
  refund_requested: { icon: 'mdi-cash-refund', tone: 'warning' },
  refund_completed: { icon: 'mdi-cash-check', tone: 'success' },
  refund_failed: { icon: 'mdi-alert-circle-outline', tone: 'error' },
  wallet_blocked: { icon: 'mdi-lock-outline', tone: 'error' },
  wallet_unblocked: { icon: 'mdi-lock-open-variant-outline', tone: 'success' },
  wallet_adjusted: { icon: 'mdi-wallet-outline', tone: 'primary' },
  invoice_voided: { icon: 'mdi-receipt-text-remove-outline', tone: 'warning' },
  invoice_restored: { icon: 'mdi-receipt-text-check-outline', tone: 'success' },
  discount_updated: { icon: 'mdi-sale-outline', tone: 'success' },
  discount_ended: { icon: 'mdi-sale-outline', tone: 'primary' },
  maintenance: { icon: 'mdi-wrench-cog-outline', tone: 'primary' },
  account_suspended: { icon: 'mdi-account-off-outline', tone: 'error' },
  account_reactivated: { icon: 'mdi-account-check-outline', tone: 'success' },
  password_changed: { icon: 'mdi-shield-key-outline', tone: 'warning' },
  new_session: { icon: 'mdi-shield-alert-outline', tone: 'warning' },
  email_changed: { icon: 'mdi-email-sync-outline', tone: 'warning' },
  totp_enabled: { icon: 'mdi-shield-check-outline', tone: 'success' },
  totp_disabled: { icon: 'mdi-shield-off-outline', tone: 'warning' },
  ticket_created: { icon: 'mdi-lifebuoy', tone: 'primary' },
  ticket_reply: { icon: 'mdi-message-reply-text-outline', tone: 'primary' },
  ticket_assigned: { icon: 'mdi-account-arrow-right-outline', tone: 'primary' },
  support_ticket_update: { icon: 'mdi-lifebuoy', tone: 'primary' },
  pro_build_failed: { icon: 'mdi-alert-circle-outline', tone: 'error' },
}
const DEFAULT_VISUAL: NotificationVisual = { icon: 'mdi-bell-outline', tone: 'primary' }

export function visualForNotification(type: string): NotificationVisual {
  return VISUALS[type] ?? DEFAULT_VISUAL
}

const TONE_TO_TOAST: Record<NotificationTone, ToastKind> = {
  primary: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error',
}

interface State {
  items: NotificationItem[]
  nextCursor: string | null
  unreadCount: number
  loading: boolean
  /** Set only when the initial panel fetch itself failed — distinct from a
   *  genuinely empty list, so the UI never claims "no notifications" when it
   *  actually just couldn't reach the server. */
  loadError: boolean
}

let socket: Socket | null = null
/** Bumped on every `load(false)` — a response is only applied if it's still
 *  the most recent request, so a slow first open can never clobber a frester
 *  one that finished first (e.g. two quick open/close taps on the bell). */
let loadToken = 0

/** Same-origin in dev (Vite proxies /socket.io) and in prod (served behind
 *  the same host) unless VITE_API_BASE_URL points at a different origin. */
function socketOrigin(): string {
  if (/^https?:\/\//.test(BASE_URL)) return new URL(BASE_URL).origin
  return window.location.origin
}

/**
 * Panel/bell state — every row here was sent with the `panel` channel. Real-time
 * delivery comes over the same WebSocket the backend's NotificationsGateway
 * pushes to; the REST endpoints back the initial load and pagination.
 */
export const useNotificationsStore = defineStore('notifications', {
  state: (): State => ({
    items: [],
    nextCursor: null,
    unreadCount: 0,
    loading: false,
    loadError: false,
  }),

  actions: {
    async load(append = false): Promise<void> {
      const token = ++loadToken
      this.loading = true
      if (!append) this.loadError = false
      try {
        const params = new URLSearchParams()
        if (append && this.nextCursor) params.set('cursor', this.nextCursor)
        const q = params.toString() ? `?${params.toString()}` : ''
        const res = await apiFetch<{ items: NotificationItem[]; nextCursor: string | null }>(
          `/notifications${q}`,
        )
        if (token !== loadToken) return // a newer load() already won
        this.items = append ? [...this.items, ...res.items] : res.items
        this.nextCursor = res.nextCursor
      } catch {
        if (token !== loadToken) return
        if (!append) this.loadError = true
      } finally {
        if (token === loadToken) this.loading = false
      }
    },

    async fetchUnreadCount(): Promise<void> {
      const res = await apiFetch<{ count: number }>('/notifications/unread-count')
      this.unreadCount = res.count
    },

    async markRead(id: string): Promise<void> {
      const row = this.items.find((n) => n.id === id)
      if (!row || row.readAt) return
      row.readAt = new Date().toISOString()
      this.unreadCount = Math.max(0, this.unreadCount - 1)
      try {
        await apiFetch(`/notifications/${id}/read`, { method: 'POST' })
      } catch {
        // Roll back — never let the panel show a state the server doesn't have.
        row.readAt = null
        this.unreadCount += 1
      }
    },

    async markAllRead(): Promise<void> {
      const before = this.items.map((n) => n.readAt)
      const beforeCount = this.unreadCount
      const now = new Date().toISOString()
      this.items.forEach((n) => {
        if (!n.readAt) n.readAt = now
      })
      this.unreadCount = 0
      try {
        await apiFetch('/notifications/read-all', { method: 'POST' })
      } catch {
        this.items.forEach((n, i) => (n.readAt = before[i]))
        this.unreadCount = beforeCount
      }
    },

    /** Removes it from the panel (server keeps the row for its own audit
     *  trail — see NotificationsService.dismiss). */
    async dismiss(id: string): Promise<void> {
      const idx = this.items.findIndex((n) => n.id === id)
      if (idx === -1) return
      const [removed] = this.items.splice(idx, 1)
      const wasUnread = !removed.readAt
      if (wasUnread) this.unreadCount = Math.max(0, this.unreadCount - 1)
      try {
        await apiFetch(`/notifications/${id}`, { method: 'DELETE' })
      } catch {
        // Roll back at the same position — never silently lose a row the
        // server still has because of a network blip.
        this.items.splice(idx, 0, removed)
        if (wasUnread) this.unreadCount += 1
      }
    },

    /** Open the real-time socket — session-cookie authenticated, no token to pass. */
    connect(): void {
      if (socket) return
      socket = io(socketOrigin(), { path: '/socket.io', withCredentials: true })

      socket.on('notification', (payload: SocketNotification) => {
        // A per-user push carries its real row id — prepend it straight into
        // the panel list. A platform-wide broadcast (discount, maintenance)
        // has no single row id to attach here (one row per user, created in
        // bulk) — the next `load()` picks it up for real; this is just the
        // pop-up + badge count.
        if (payload.id) this.items = [payload as NotificationItem, ...this.items]
        this.unreadCount += 1

        const visual = visualForNotification(payload.type ?? '')
        const to = payload.id ? routeForNotification(payload as NotificationItem) : null
        useToastStore().push(TONE_TO_TOAST[visual.tone], `${payload.title}\n${payload.body}`, {
          timeout: 7000,
          action: to ? { label: i18n.global.t('notifications.open'), to } : undefined,
        })
      })

      socket.on('notification:sync', (msg: SocketSync) => {
        if (msg.kind === 'read' && msg.id) {
          const row = this.items.find((n) => n.id === msg.id)
          if (row && !row.readAt) {
            row.readAt = new Date().toISOString()
            this.unreadCount = Math.max(0, this.unreadCount - 1)
          }
        } else if (msg.kind === 'read-all') {
          const now = new Date().toISOString()
          this.items.forEach((n) => {
            if (!n.readAt) n.readAt = now
          })
          this.unreadCount = 0
        } else if (msg.kind === 'dismissed' && msg.id) {
          const idx = this.items.findIndex((n) => n.id === msg.id)
          if (idx !== -1) {
            const wasUnread = !this.items[idx].readAt
            this.items.splice(idx, 1)
            if (wasUnread) this.unreadCount = Math.max(0, this.unreadCount - 1)
          }
        }
      })

      // A reconnect (network blip, laptop sleep) can silently skip whatever
      // was pushed while disconnected — socket.io has no delivery guarantee.
      // The unread count is cheap to re-sync every time the socket comes up,
      // `connect` fires on the FIRST connect too so this covers both cases.
      socket.on('connect', () => {
        void this.fetchUnreadCount().catch(() => {})
      })
    },

    disconnect(): void {
      socket?.disconnect()
      socket = null
    },

    reset(): void {
      this.disconnect()
      this.$reset()
    },
  },
})
