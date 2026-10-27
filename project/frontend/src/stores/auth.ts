import { defineStore } from 'pinia'

import { apiFetch, ApiError } from '@/services/api'

export type PlatformRole = 'admin' | 'support' | 'finance' | 'moderator'

export interface AuthUser {
  id: string
  email: string
  name: string
  platformRoles: PlatformRole[]
  emailVerifiedAt: string | null
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
    /**
     * Only the roles that may actually work the support queue — mirrors the
     * backend's `SUPPORT_STAFF_ROLES` (support.constants.ts). Distinct from
     * `isPlatformStaff`, which is true for ANY platform role: gating the
     * support UI on that one handed `finance`/`moderator` accounts a broken
     * queue view (no "New ticket" button, 403s on the staff endpoints).
     */
    isSupportStaff: (state): boolean => {
      const roles = state.user?.platformRoles ?? []
      return roles.includes('admin') || roles.includes('support')
    },
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

    /**
     * Creates the account but never signs it in — the account isn't usable
     * until its email is verified, so this must not grant a session (that
     * used to happen here, which let an unverified signup browse the whole
     * platform). `login()` is what actually starts the session, once
     * `verifyEmail()` has unblocked it.
     */
    async register(input: { email: string; password: string; name: string }): Promise<AuthUser> {
      const { user } = await apiFetch<{ user: AuthUser }>('/auth/register', {
        method: 'POST',
        body: input,
      })
      return user
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

      // If the visitor arrived on an affiliate link, attribute the account to
      // it now that there's finally a session to attribute it to. Best-effort
      // — a bad/expired/already-claimed code just no-ops server-side, and
      // `tvz.ref` is removed after the first attempt so this never re-fires
      // on a later, unrelated login.
      let ref: string | null = null
      try {
        ref = localStorage.getItem('tvz.ref')
      } catch {
        /* ignore */
      }
      if (ref) {
        try {
          await apiFetch('/affiliate/claim', { method: 'POST', body: { code: ref } })
        } catch {
          /* ignore */
        }
        try {
          localStorage.removeItem('tvz.ref')
        } catch {
          /* ignore */
        }
      }
    },

    /** Resends the email-verification code — enumeration-safe on the backend
     *  (always resolves the same way), used identically from the setup
     *  wizard and from a blocked login attempt. */
    resendVerification(email: string): Promise<{ ok: true }> {
      return apiFetch('/auth/email/resend', { method: 'POST', body: { email } })
    },

    /**
     * Verifies the code. Never itself starts a session — neither entry point
     * (fresh setup-wizard signup, or a login rejected pre-verification) has
     * one at this point; both re-submit `login()` after this resolves.
     * Refreshes `this.user` when there already is one (a currently-logged-in
     * user re-verifying) so `emailVerifiedAt` flips immediately.
     */
    async verifyEmail(email: string, code: string): Promise<{ ok: true }> {
      const result = await apiFetch<{ ok: true }>('/auth/email/verify', {
        method: 'POST',
        body: { email, code },
      })
      if (this.user && this.user.email === email) {
        this.user = { ...this.user, emailVerifiedAt: new Date().toISOString() }
      }
      return result
    },

    /**
     * Optimistic: clears local auth state synchronously so the UI can redirect
     * immediately, then revokes the server session in the background. The request
     * still carries the cookie and completes even after navigation.
     */
    logout(): void {
      this.user = null
      apiFetch('/auth/logout', { method: 'POST' }).catch((err) => {
        console.warn('logout request failed', err)
      })
    },
  },
})
