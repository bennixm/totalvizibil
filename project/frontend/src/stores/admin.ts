import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'
import type { PlatformRole } from '@/stores/auth'

export interface AdminStats {
  users: {
    total: number
    active: number
    suspended: number
    withTwoFactor: number
    staff: number
    new7d: number
    new30d: number
  }
  companies: {
    total: number
    draft: number
    active: number
    suspended: number
    withWebsite: number
    websitesPublished: number
    new7d: number
    new30d: number
    byCountry: { country: string; count: number }[]
  }
  staffByRole: { role: PlatformRole; count: number }[]
  activeSessions: number
  signups: { date: string; users: number; companies: number }[]
  listings: { _status: string; note: string }
  generatedAt: string
}

export type UserStatus = 'active' | 'suspended'

export interface AdminUserRow {
  id: string
  email: string
  name: string
  status: UserStatus
  platformRoles: PlatformRole[]
  twoFactorEnabled: boolean
  companyCount: number
  lastLoginAt: string | null
  createdAt: string
}

export interface AdminUserDetail {
  id: string
  email: string
  name: string
  status: UserStatus
  platformRoles: PlatformRole[]
  twoFactorEnabled: boolean
  lastLoginAt: string | null
  passwordChangedAt: string | null
  createdAt: string
  updatedAt: string
  companies: { id: string; displayName: string; slug: string; status: string; role: string }[]
  sessions: { id: string; userAgent: string | null; ip: string | null; createdAt: string }[]
}

export interface UsersFilters {
  search: string
  status: UserStatus | null
  role: PlatformRole | null
  page: number
  pageSize: number
}

interface AdminState {
  stats: AdminStats | null
  users: AdminUserRow[]
  usersTotal: number
  filters: UsersFilters
  loadingUsers: boolean
}

export interface UpdateUserInput {
  name?: string
  email?: string
  status?: UserStatus
  platformRoles?: PlatformRole[]
  disableTotp?: boolean
  revokeSessions?: boolean
}

export const useAdminStore = defineStore('admin', {
  state: (): AdminState => ({
    stats: null,
    users: [],
    usersTotal: 0,
    filters: { search: '', status: null, role: null, page: 1, pageSize: 20 },
    loadingUsers: false,
  }),

  actions: {
    async fetchStats(): Promise<void> {
      this.stats = await apiFetch<AdminStats>('/admin/stats')
    },

    async fetchUsers(): Promise<void> {
      this.loadingUsers = true
      try {
        const p = new URLSearchParams()
        if (this.filters.search.trim()) p.set('search', this.filters.search.trim())
        if (this.filters.status) p.set('status', this.filters.status)
        if (this.filters.role) p.set('role', this.filters.role)
        p.set('page', String(this.filters.page))
        p.set('pageSize', String(this.filters.pageSize))
        const res = await apiFetch<{ items: AdminUserRow[]; total: number; page: number }>(
          `/admin/users?${p.toString()}`,
        )
        this.users = res.items
        this.usersTotal = res.total
      } finally {
        this.loadingUsers = false
      }
    },

    setFilter<K extends keyof UsersFilters>(key: K, value: UsersFilters[K]): void {
      this.filters[key] = value
      if (key !== 'page') this.filters.page = 1
      void this.fetchUsers()
    },

    fetchUser(id: string): Promise<AdminUserDetail> {
      return apiFetch<AdminUserDetail>(`/admin/users/${id}`)
    },

    updateUser(id: string, input: UpdateUserInput): Promise<AdminUserDetail> {
      return apiFetch<AdminUserDetail>(`/admin/users/${id}`, { method: 'PATCH', body: input })
    },

    setUserPassword(id: string, newPassword: string): Promise<{ ok: true }> {
      return apiFetch<{ ok: true }>(`/admin/users/${id}/password`, {
        method: 'POST',
        body: { newPassword },
      })
    },
  },
})
