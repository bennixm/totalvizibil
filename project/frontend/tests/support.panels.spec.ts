import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiFetch } from '@/services/api'
import { useAuthStore, type PlatformRole } from '@/stores/auth'
import { routeForNotification } from '@/stores/notifications'
import { useSupportStore } from '@/stores/support'

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api')
  return { ...actual, apiFetch: vi.fn() }
})
const apiFetchMock = vi.mocked(apiFetch)

function signIn(roles: PlatformRole[]): void {
  useAuthStore().user = {
    id: 'me',
    email: 'me@example.com',
    name: 'Me',
    platformRoles: roles,
    emailVerifiedAt: null,
  }
}

/**
 * Support lives in two panels: the normal panel is the customer view for
 * everyone, the admin panel is the staff queue. These pin the two places
 * where that split is decided outside the pages themselves.
 */
describe('support: panel separation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetchMock.mockReset()
    apiFetchMock.mockResolvedValue({ items: [], nextCursor: null })
  })

  describe('notification links', () => {
    const ticket = (type: string) => ({ type, data: { ticketId: 't1' } })

    it('queue work opens in the admin panel for support staff', () => {
      signIn(['support'])
      for (const type of ['ticket_created', 'ticket_reply', 'ticket_assigned', 'ticket_reopened']) {
        expect(routeForNotification(ticket(type))).toEqual({
          name: 'admin-support-ticket',
          params: { id: 't1' },
        })
      }
    })

    it("a staff member's OWN ticket update opens in the normal panel", () => {
      signIn(['admin'])
      for (const type of ['support_ticket_update', 'ticket_assigned_requester']) {
        expect(routeForNotification(ticket(type))).toEqual({
          name: 'support-ticket',
          params: { id: 't1' },
        })
      }
    })

    it('non-queue roles always land in the normal panel', () => {
      for (const roles of [[], ['finance'], ['moderator']] as PlatformRole[][]) {
        setActivePinia(createPinia())
        signIn(roles)
        expect(routeForNotification(ticket('ticket_reply'))).toEqual({
          name: 'support-ticket',
          params: { id: 't1' },
        })
      }
    })
  })

  describe('API perspective', () => {
    it('the normal panel asks as a requester, on every call', async () => {
      const s = useSupportStore()
      s.setPerspective('requester')
      apiFetchMock.mockResolvedValue({ items: [], nextCursor: null })
      await s.loadList({ statusGroup: 'active' })
      await s.loadCounts()
      await s.loadTicket('t1')
      await s.patch('t1', { status: 'closed' })
      await s.reply('t1', 'hi')
      const paths = apiFetchMock.mock.calls.map((c) => String(c[0]))
      expect(paths).toEqual([
        '/support/tickets?as=requester&statusGroup=active',
        '/support/counts?as=requester',
        '/support/tickets/t1?as=requester',
        '/support/tickets/t1?as=requester',
        '/support/tickets/t1/messages?as=requester',
      ])
      expect(s.attachmentUrl('t1', 'a1')).toMatch(
        /\/support\/tickets\/t1\/attachments\/a1\?as=requester$/,
      )
    })

    it('the admin panel asks without narrowing', async () => {
      const s = useSupportStore()
      s.setPerspective('staff')
      await s.loadList({})
      await s.loadCounts()
      expect(apiFetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
        '/support/tickets',
        '/support/counts',
      ])
    })

    it('switching panel drops what the other side had loaded', () => {
      const s = useSupportStore()
      s.setPerspective('staff')
      s.list = [{ id: 'x' } as never]
      s.counts = { active: 9, waiting: 0, done: 0, all: 9 }
      s.setPerspective('requester')
      expect(s.list).toEqual([])
      expect(s.counts).toBeNull()
      expect(s.ticket).toBeNull()
    })
  })
})
