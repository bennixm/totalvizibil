import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiFetch, ApiError } from '@/services/api'
import { useAuthStore, type PlatformRole } from '@/stores/auth'

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api')
  return { ...actual, apiFetch: vi.fn() }
})

const apiFetchMock = vi.mocked(apiFetch)

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetchMock.mockReset()
  })

  it('starts unauthenticated and not ready', () => {
    const auth = useAuthStore()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.ready).toBe(false)
  })

  it('bootstrap sets the user when /auth/me succeeds', async () => {
    apiFetchMock.mockResolvedValueOnce({
      user: { id: 'u1', email: 'a@b.com', name: 'A', platformRoles: [] },
    })
    const auth = useAuthStore()
    await auth.bootstrap()
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.ready).toBe(true)
    expect(auth.user?.email).toBe('a@b.com')
  })

  it('bootstrap treats 401 as simply logged-out', async () => {
    apiFetchMock.mockRejectedValueOnce(new ApiError(401, 'Not authenticated'))
    const auth = useAuthStore()
    await auth.bootstrap()
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.ready).toBe(true)
  })

  it('bootstrap runs the request only once', async () => {
    apiFetchMock.mockResolvedValue({
      user: { id: 'u1', email: 'a@b.com', name: 'A', platformRoles: [] },
    })
    const auth = useAuthStore()
    await auth.bootstrap()
    await auth.bootstrap()
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
  })

  it('login stores the returned user', async () => {
    apiFetchMock.mockResolvedValueOnce({
      user: { id: 'u9', email: 'x@y.com', name: 'X', platformRoles: ['admin'] },
    })
    const auth = useAuthStore()
    await auth.login({ email: 'x@y.com', password: 'password123' })
    expect(auth.user?.id).toBe('u9')
    expect(auth.isPlatformStaff).toBe(true)
  })

  it('isSupportStaff is true only for admin/support, isPlatformStaff for any role', () => {
    const auth = useAuthStore()
    const withRoles = (platformRoles: PlatformRole[]) => {
      auth.user = {
        id: 'u1',
        email: 'a@b.com',
        name: 'A',
        platformRoles,
        emailVerifiedAt: null,
      }
    }

    withRoles([])
    expect(auth.isPlatformStaff).toBe(false)
    expect(auth.isSupportStaff).toBe(false)

    withRoles(['admin'])
    expect(auth.isSupportStaff).toBe(true)

    withRoles(['support'])
    expect(auth.isSupportStaff).toBe(true)

    // Platform staff, but NOT support staff — these must get the ordinary
    // customer support view, not the agent queue.
    withRoles(['finance'])
    expect(auth.isPlatformStaff).toBe(true)
    expect(auth.isSupportStaff).toBe(false)

    withRoles(['moderator'])
    expect(auth.isPlatformStaff).toBe(true)
    expect(auth.isSupportStaff).toBe(false)

    withRoles(['moderator', 'support'])
    expect(auth.isSupportStaff).toBe(true)

    auth.user = null
    expect(auth.isSupportStaff).toBe(false)
  })

  it('isFinanceStaff is true only for admin/finance', () => {
    const auth = useAuthStore()
    const withRoles = (platformRoles: PlatformRole[]) => {
      auth.user = {
        id: 'u1',
        email: 'a@b.com',
        name: 'A',
        platformRoles,
        emailVerifiedAt: null,
      }
    }

    withRoles([])
    expect(auth.isFinanceStaff).toBe(false)

    withRoles(['admin'])
    expect(auth.isFinanceStaff).toBe(true)

    withRoles(['finance'])
    expect(auth.isFinanceStaff).toBe(true)

    // Platform staff, but with no business in the Financiar area — the sidebar
    // group and the /admin landing redirect both hang off this.
    withRoles(['support'])
    expect(auth.isPlatformStaff).toBe(true)
    expect(auth.isFinanceStaff).toBe(false)

    withRoles(['moderator'])
    expect(auth.isPlatformStaff).toBe(true)
    expect(auth.isFinanceStaff).toBe(false)

    withRoles(['moderator', 'finance'])
    expect(auth.isFinanceStaff).toBe(true)

    auth.user = null
    expect(auth.isFinanceStaff).toBe(false)
  })

  // The badge + sidebar mode switch hang off this one. `isPlatformStaff` is
  // true for ANY role, `moderator` included — and `moderator` unlocks no
  // backend endpoint and no nav item, so gating staff UI chrome on it
  // advertised an admin area with zero reachable pages behind it.
  it('hasReachableStaffArea is true only for admin/support/finance, never moderator alone', () => {
    const auth = useAuthStore()
    const withRoles = (platformRoles: PlatformRole[]) => {
      auth.user = {
        id: 'u1',
        email: 'a@b.com',
        name: 'A',
        platformRoles,
        emailVerifiedAt: null,
      }
    }

    withRoles([])
    expect(auth.hasReachableStaffArea).toBe(false)

    withRoles(['admin'])
    expect(auth.hasReachableStaffArea).toBe(true)

    withRoles(['support'])
    expect(auth.hasReachableStaffArea).toBe(true)

    withRoles(['finance'])
    expect(auth.hasReachableStaffArea).toBe(true)

    // The whole point: platform staff by `isPlatformStaff`, but with nothing
    // anywhere it can actually open.
    withRoles(['moderator'])
    expect(auth.isPlatformStaff).toBe(true)
    expect(auth.hasReachableStaffArea).toBe(false)

    withRoles(['moderator', 'support'])
    expect(auth.hasReachableStaffArea).toBe(true)

    auth.user = null
    expect(auth.hasReachableStaffArea).toBe(false)
  })

  it('logout clears the user even if the request fails', async () => {
    apiFetchMock.mockResolvedValueOnce({
      user: { id: 'u1', email: 'a@b.com', name: 'A', platformRoles: [] },
    })
    const auth = useAuthStore()
    await auth.login({ email: 'a@b.com', password: 'password123' })
    apiFetchMock.mockRejectedValueOnce(new Error('network'))
    await auth.logout()
    expect(auth.isAuthenticated).toBe(false)
  })
})
