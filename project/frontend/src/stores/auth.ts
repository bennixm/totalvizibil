import { defineStore } from 'pinia'

import { apiFetch, ApiError } from '@/services/api'

export type PlatformRole = 'admin' | 'support' | 'finance' | 'moderator'

export interface AuthUser {
  id: string
  email: string
  name: string
  platformRoles: PlatformRole[]
}

interface AuthState {
  user: AuthUser | null
  ready: boolean
}

// De-dupes concurrent bootstrap() calls (e.g. several router navigations firing
// before the first /auth/me resolves) into a single in-flight request.
let bootstrapInFlight: Promise<void> | null = null

/**
 * Session state. The source of truth is the backend httpOnly cookie; this store
 * only mirrors the resolved user. `bootstrap()` runs once on app start.
 */
export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    ready: false,
  }),

  getters: {
    isAuthenticated: (state): boolean => state.user !== null,
    isPlatformStaff: (state): boolean => (state.user?.platformRoles.length ?? 0) > 0,
  },

  actions: {
    async bootstrap(): Promise<void> {
      if (this.ready) return
      if (bootstrapInFlight) return bootstrapInFlight

      bootstrapInFlight = (async () => {
        try {
          const { user } = await apiFetch<{ user: AuthUser }>('/auth/me')
          this.user = user
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 401)) {
            console.error('auth bootstrap failed', err)
          }
          this.user = null
        } finally {
          this.ready = true
          bootstrapInFlight = null
        }
      })()

      return bootstrapInFlight
    },

    async register(input: { email: string; password: string; name: string }): Promise<void> {
      const { user } = await apiFetch<{ user: AuthUser }>('/auth/register', {
        method: 'POST',
        body: input,
      })
      this.user = user
      this.ready = true
    },

    async login(input: {
      email: string
      password: string
      totpCode?: string
    }): Promise<void> {
      const { user } = await apiFetch<{ user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: input,
      })
      this.user = user
      this.ready = true
    },

    async logout(): Promise<void> {
      try {
        await apiFetch('/auth/logout', { method: 'POST' })
      } catch (err) {
        // Client-side logout must always succeed; the cookie will lapse anyway.
        console.warn('logout request failed', err)
      } finally {
        this.user = null
      }
    },
  },
})
