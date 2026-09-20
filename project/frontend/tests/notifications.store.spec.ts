import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiFetch } from '@/services/api'
import {
  routeForNotification,
  useNotificationsStore,
  visualForNotification,
  type NotificationItem,
} from '@/stores/notifications'

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api')
  return { ...actual, apiFetch: vi.fn() }
})

const apiFetchMock = vi.mocked(apiFetch)

function item(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'n1',
    type: 'lead_received',
    title: 'T',
    body: 'B',
    data: null,
    createdAt: new Date().toISOString(),
    readAt: null,
    ...overrides,
  }
}

describe('notifications store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetchMock.mockReset()
  })

  it('markRead marks the item read and decrements the badge optimistically', async () => {
    apiFetchMock.mockResolvedValueOnce({ ok: true })
    const store = useNotificationsStore()
    store.items = [item()]
    store.unreadCount = 1

    await store.markRead('n1')

    expect(store.items[0].readAt).not.toBeNull()
    expect(store.unreadCount).toBe(0)
  })

  it('markRead rolls back if the server call fails', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('network'))
    const store = useNotificationsStore()
    store.items = [item()]
    store.unreadCount = 1

    await store.markRead('n1')

    expect(store.items[0].readAt).toBeNull()
    expect(store.unreadCount).toBe(1)
  })

  it('markRead is a no-op for an already-read item (never double-decrements)', async () => {
    const store = useNotificationsStore()
    store.items = [item({ readAt: new Date().toISOString() })]
    store.unreadCount = 0

    await store.markRead('n1')

    expect(apiFetchMock).not.toHaveBeenCalled()
    expect(store.unreadCount).toBe(0)
  })

  it('markAllRead rolls back every item + the count if the server call fails', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('network'))
    const store = useNotificationsStore()
    store.items = [item({ id: 'a' }), item({ id: 'b' })]
    store.unreadCount = 2

    await store.markAllRead()

    expect(store.items.every((n) => n.readAt === null)).toBe(true)
    expect(store.unreadCount).toBe(2)
  })

  it('dismiss removes the item and adjusts the badge only if it was unread', async () => {
    apiFetchMock.mockResolvedValueOnce({ ok: true })
    const store = useNotificationsStore()
    store.items = [item({ id: 'a' }), item({ id: 'b', readAt: new Date().toISOString() })]
    store.unreadCount = 1

    await store.dismiss('a')
    expect(store.items.map((n) => n.id)).toEqual(['b'])
    expect(store.unreadCount).toBe(0)

    await store.dismiss('b')
    expect(store.items).toHaveLength(0)
    expect(store.unreadCount).toBe(0) // was already read — no further decrement
  })

  it('dismiss re-inserts the item at the same position if the server call fails', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('network'))
    const store = useNotificationsStore()
    store.items = [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })]
    store.unreadCount = 3

    await store.dismiss('b')

    expect(store.items.map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(store.unreadCount).toBe(3)
  })

  it('load() ignores a slow response once a newer load() has already resolved', async () => {
    const store = useNotificationsStore()
    let resolveFirst!: (v: { items: NotificationItem[]; nextCursor: string | null }) => void
    apiFetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
    )
    apiFetchMock.mockResolvedValueOnce({ items: [item({ id: 'fresh' })], nextCursor: null })

    const first = store.load(false) // slow
    const second = store.load(false) // fast, resolves first
    await second
    expect(store.items.map((n) => n.id)).toEqual(['fresh'])

    resolveFirst({ items: [item({ id: 'stale' })], nextCursor: null })
    await first
    // The stale response must NOT overwrite the fresher one that already landed.
    expect(store.items.map((n) => n.id)).toEqual(['fresh'])
  })

  it('load() sets loadError on a failed initial fetch but leaves existing items alone on a failed "load more"', async () => {
    const store = useNotificationsStore()
    apiFetchMock.mockRejectedValueOnce(new Error('network'))
    await store.load(false)
    expect(store.loadError).toBe(true)
    expect(store.items).toEqual([])

    apiFetchMock.mockResolvedValueOnce({ items: [item()], nextCursor: 'cur1' })
    await store.load(false)
    expect(store.loadError).toBe(false)
    expect(store.items).toHaveLength(1)

    apiFetchMock.mockRejectedValueOnce(new Error('network'))
    await store.load(true)
    expect(store.loadError).toBe(false) // an append failure doesn't blank the whole panel
    expect(store.items).toHaveLength(1)
  })

  it('routeForNotification resolves the discount/invoice pairs to the same destination regardless of direction', () => {
    const wallet = { name: 'wallet' }
    expect(routeForNotification({ type: 'discount_updated', data: null })).toEqual(wallet)
    expect(routeForNotification({ type: 'discount_ended', data: null })).toEqual(wallet)
    expect(
      routeForNotification({ type: 'invoice_voided', data: { invoiceId: 'i1' } }),
    ).toEqual({ name: 'invoice-print', params: { id: 'i1' } })
    expect(
      routeForNotification({ type: 'invoice_restored', data: { invoiceId: 'i1' } }),
    ).toEqual({ name: 'invoice-print', params: { id: 'i1' } })
  })

  it('routeForNotification returns null when there is nowhere to go', () => {
    expect(routeForNotification({ type: 'maintenance', data: null })).toBeNull()
    expect(routeForNotification({ type: 'lead_received', data: null })).toBeNull()
  })

  it('visualForNotification falls back to a neutral bell for an unknown type', () => {
    expect(visualForNotification('some_future_type')).toEqual({
      icon: 'mdi-bell-outline',
      tone: 'primary',
    })
    expect(visualForNotification('payment_succeeded').tone).toBe('success')
    expect(visualForNotification('wallet_blocked').tone).toBe('error')
  })
})
