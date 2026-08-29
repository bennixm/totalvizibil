import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'
import { useAuthStore, type AuthUser } from '@/stores/auth'

export interface SecurityInfo {
  twoFactor: { enabled: boolean; pendingSetup: boolean }
  passwordChangedAt: string | null
  email: string
  name: string
}

export interface ActiveSession {
  id: string
  userAgent: string | null
  ip: string | null
  createdAt: string
  current: boolean
}

interface AccountState {
  security: SecurityInfo | null
  sessions: ActiveSession[]
  totpSetup: { secret: string; otpauthUrl: string } | null
}

export const useAccountStore = defineStore('account', {
  state: (): AccountState => ({
    security: null,
    sessions: [],
    totpSetup: null,
  }),

  actions: {
    async loadSecurity(): Promise<void> {
      this.security = await apiFetch<SecurityInfo>('/account/security')
    },

    async loadSessions(): Promise<void> {
      this.sessions = await apiFetch<ActiveSession[]>('/account/sessions')
    },

    async updateProfile(input: {
      name?: string
      email?: string
      currentPassword?: string
    }): Promise<void> {
      const user = await apiFetch<AuthUser>('/account/profile', { method: 'PATCH', body: input })
      useAuthStore().$patch({ user })
      await this.loadSecurity()
    },

    changePassword(input: { currentPassword: string; newPassword: string }): Promise<{ ok: true }> {
      return apiFetch<{ ok: true }>('/account/password', { method: 'POST', body: input })
    },

    async startTotpSetup(): Promise<void> {
      this.totpSetup = await apiFetch<{ secret: string; otpauthUrl: string }>('/account/totp/setup', {
        method: 'POST',
      })
    },

    async enableTotp(code: string): Promise<void> {
      await apiFetch('/account/totp/enable', { method: 'POST', body: { code } })
      this.totpSetup = null
      await this.loadSecurity()
    },

    async disableTotp(code: string): Promise<void> {
      await apiFetch('/account/totp/disable', { method: 'POST', body: { code } })
      await this.loadSecurity()
    },

    async revokeOtherSessions(): Promise<number> {
      const { revoked } = await apiFetch<{ revoked: number }>('/account/sessions/others', {
        method: 'DELETE',
      })
      await this.loadSessions()
      return revoked
    },
  },
})
