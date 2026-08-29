import { defineStore } from 'pinia'

/** Matches the "Main Users" split in docs/02-PRODUCT.md. */
export type UserRole = 'customer' | 'business' | 'admin'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: UserRole
}

interface AuthState {
  user: AuthUser | null
  token: string | null
}

/**
 * Skeleton auth store. Wiring to the backend API lives in Phase 1
 * (see docs/04-ROADMAP.md — Authentication).
 */
export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    token: null,
  }),

  persist: {
    key: 'tvz.auth',
    pick: ['token'],
  },

  getters: {
    isAuthenticated: (state): boolean => state.user !== null,
    role: (state): UserRole | null => state.user?.role ?? null,
  },

  actions: {
    setSession(user: AuthUser, token: string) {
      this.user = user
      this.token = token
    },
    clear() {
      this.user = null
      this.token = null
    },
  },
})
