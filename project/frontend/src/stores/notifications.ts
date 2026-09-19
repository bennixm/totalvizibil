import { defineStore } from 'pinia'
import { io, type Socket } from 'socket.io-client'

import { apiFetch, BASE_URL } from '@/services/api'
import { useToastStore } from '@/stores/toast'

export interface NotificationItem {
  id: string
  type: string
  title: string
  body: string
  data: Record<string, unknown> | null
  createdAt: string
  readAt: string | null
}

interface State {
  items: NotificationItem[]
  nextCursor: string | null
  unreadCount: number
  loading: boolean
}

let socket: Socket | null = null

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
  }),

  actions: {
    async load(append = false): Promise<void> {
      this.loading = true
      try {
        const params = new URLSearchParams()
        if (append && this.nextCursor) params.set('cursor', this.nextCursor)
        const q = params.toString() ? `?${params.toString()}` : ''
        const res = await apiFetch<{ items: NotificationItem[]; nextCursor: string | null }>(
          `/notifications${q}`,
        )
        this.items = append ? [...this.items, ...res.items] : res.items
        this.nextCursor = res.nextCursor
      } finally {
        this.loading = false
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
      await apiFetch(`/notifications/${id}/read`, { method: 'POST' }).catch(() => {})
    },

    async markAllRead(): Promise<void> {
      const now = new Date().toISOString()
      this.items.forEach((n) => {
        if (!n.readAt) n.readAt = now
      })
      this.unreadCount = 0
      await apiFetch('/notifications/read-all', { method: 'POST' }).catch(() => {})
    },

    /** Open the real-time socket — session-cookie authenticated, no token to pass. */
    connect(): void {
      if (socket) return
      socket = io(socketOrigin(), { path: '/socket.io', withCredentials: true })
      socket.on('notification', (payload: Partial<NotificationItem> & { title: string }) => {
        // A per-user push carries its real row id — prepend it straight into
        // the panel list. A platform-wide broadcast (discount, maintenance)
        // has no single row id to attach here (one row per user, created in
        // bulk) — the next `load()` picks it up for real; this is just the
        // pop-up + badge count.
        if (payload.id) this.items = [payload as NotificationItem, ...this.items]
        this.unreadCount += 1
        useToastStore().info(payload.title, { timeout: 6000 })
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
