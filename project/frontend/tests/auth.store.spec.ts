import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiFetch, ApiError } from '@/services/api'
import { useAuthStore } from '@/stores/auth'

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
