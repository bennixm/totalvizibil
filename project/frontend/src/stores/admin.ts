import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'
import type { PlatformRole } from '@/stores/auth'
import type { CampaignPayload, SaveCampaignInput } from '@/stores/campaign'
import type { DashboardAnalytics, LocalizedName } from '@/stores/companies'

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
  economy: {
    creditsSold: Money
    creditsSold30d: Money
    ronCollected: number
    ronCollected30d: number
    cpcConsumed: Money
    cpcConsumed30d: Money
    refunded: Money
    pendingPurchases: number
    walletsBlocked: number
  }
  campaigns: {
    active: number
    paused: number
    depleted: number
    draft: number
    autoOptimize: number
    committedDailyBudget: Money
    clicks30d: number
    leads30d: number
  }
  staffByRole: { role: PlatformRole; count: number }[]
  activeSessions: number
  signups: { date: string; users: number; companies: number }[]
  economySeries: { date: string; sold: number; consumed: number }[]
  /** Live EUR->RON rate, for the RON equivalent shown next to platform credit totals. */
  eurRonRate: number
  generatedAt: string
}

export interface AdminSettings {
  eurRonRate: number
  advancedBuilderPriceCredits: number
  additionalBusinessPriceCredits: number
  invoiceVatRatePct: number
  invoiceIssuerName: string
  invoiceIssuerTaxId: string
  invoiceIssuerRegCom: string
  invoiceIssuerAddress: string
  invoiceIssuerIban: string
  invoiceIssuerBank: string
}

export type UserStatus = 'active' | 'suspended'
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'depleted'

interface Money {
  minor: number
  credits: number
}

export interface AdminUserRow {
  id: string
  email: string
  name: string
  status: UserStatus
  platformRoles: PlatformRole[]
  twoFactorEnabled: boolean
  companyCount: number
  walletCredits: number
  walletBlocked: boolean
  lastLoginAt: string | null
  createdAt: string
}

export interface AdminUserCompany {
  id: string
  displayName: string
  slug: string
  status: 'draft' | 'active' | 'suspended'
  role: string
  isOwner: boolean
  leadCount: number
  clickCount: number
  consumed: Money
  createdAt: string
  campaign: {
    status: CampaignStatus
    dailyBudget: Money
    cpc: Money
    appearFirst: boolean
    spentToday: Money
    activeDays: number
  } | null
}

export interface AdminUserTxn {
  id: string
  type: 'purchase' | 'spend' | 'refund' | 'adjustment'
  status: string
  amount: Money
  balanceAfter: Money | null
  description: string | null
  companyName: string | null
  clicks: number | null
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
  wallet: {
    balance: Money
    purchased: Money
    spent: Money
    currency: string
    eurRonRate: number
    blocked: boolean
    blockedAt: string | null
    blockedReason: string | null
  }
  companies: AdminUserCompany[]
  transactions: AdminUserTxn[]
  invoices: AdminUserInvoice[]
  sessions: { id: string; userAgent: string | null; ip: string | null; createdAt: string }[]
}

/** Compact invoice row embedded in a user's admin detail page. */
export interface AdminUserInvoice {
  id: string
  number: string
  totalMinor: number
  currency: string
  voided: boolean
  issuedAt: string
}

export type InvoiceStatusFilter = 'issued' | 'void'

/** One row in the global admin invoices list. */
export interface AdminInvoiceRow {
  id: string
  number: string
  issuedAt: string
  buyerKind: 'individual' | 'company'
  buyerName: string
  totalMinor: number
  currency: string
  voidedAt: string | null
  voidReason: string | null
  user: { id: string; email: string; name: string }
}

export interface InvoicesFilters {
  search: string
  status: InvoiceStatusFilter | null
  page: number
  pageSize: number
}

export interface UsersFilters {
  search: string
  status: UserStatus | null
  role: PlatformRole | null
  page: number
  pageSize: number
}

export type BusinessStatus = 'draft' | 'active' | 'suspended'
export type CampaignFilter = 'none' | CampaignStatus

export interface AdminBusinessRow {
  id: string
  displayName: string
  slug: string
  status: BusinessStatus
  country: string
  city: string | null
  category: LocalizedName | null
  owner: { id: string; name: string; email: string }
  createdAt: string
  campaign: {
    status: CampaignStatus
    dailyBudget: Money
    cpc: Money
    autoOptimize: boolean
  } | null
  leadCount: number
  clickCount: number
  consumed: Money
}

export interface BusinessesFilters {
  search: string
  status: BusinessStatus | null
  campaign: CampaignFilter | null
  page: number
  pageSize: number
}

export interface AdminCategory {
  id: string
  parentId: string | null
  slug: string
  name: Record<string, string>
  icon: string | null
  isActive: boolean
  position: number
  companyCount: number
  childCount: number
}

export interface AdminCategoryGroup extends AdminCategory {
  children: AdminCategory[]
}

interface AdminState {
  stats: AdminStats | null
  users: AdminUserRow[]
  usersTotal: number
  filters: UsersFilters
  loadingUsers: boolean
  businesses: AdminBusinessRow[]
  businessesTotal: number
  businessFilters: BusinessesFilters
  loadingBusinesses: boolean
  settings: AdminSettings | null
  categories: AdminCategoryGroup[]
  loadingCategories: boolean
  invoices: AdminInvoiceRow[]
  invoicesTotal: number
  invoiceFilters: InvoicesFilters
  loadingInvoices: boolean
}

export interface UpdateUserInput {
  name?: string
  email?: string
  status?: UserStatus
  platformRoles?: PlatformRole[]
  disableTotp?: boolean
  revokeSessions?: boolean
}

export type CampaignAction = 'pause' | 'activate' | 'delete'

export interface CategoryNameInput {
  ro: string
  en: string
  de: string
}
export interface CreateCategoryInput {
  parentId?: string
  slug: string
  name: CategoryNameInput
  icon?: string
  isActive?: boolean
  position?: number
}
export interface UpdateCategoryInput {
  slug?: string
  name?: CategoryNameInput
  icon?: string
  isActive?: boolean
  position?: number
  parentId?: string | null
}

// --- single business admin view -----------------------------------

export interface AdminCompanyLead {
  id: string
  channel: 'form' | 'call'
  status: 'new' | 'seen' | 'resolved'
  name: string | null
  email: string | null
  /** Null until the owner revealed it (form leads). */
  phone: string | null
  hasPhone: boolean
  message: string | null
  firstResponseAt: string | null
  resolvedAt: string | null
  responseMinutes: number | null
  createdAt: string
}

export interface AdminCompanyDetail {
  company: {
    id: string
    displayName: string
    legalName: string | null
    slug: string
    description: string | null
    status: 'draft' | 'active' | 'suspended'
    country: string
    createdAt: string
    advancedUnlockedAt: string | null
    category: {
      slug: string
      name: LocalizedName
      parent: { slug: string; name: LocalizedName } | null
    } | null
    location: {
      city: string | null
      region: string | null
      radiusKm: number | null
      nationwide: boolean
      lat: number | null
      lng: number | null
    } | null
    website: {
      mode: 'easy' | 'advanced'
      status: 'draft' | 'published' | 'unpublished'
      updatedAt: string
    } | null
    owner: { id: string; name: string; email: string; status: UserStatus }
    counts: { services: number; contacts: number; leads: number; clicks: number }
  }
  campaign: CampaignPayload
  analytics: DashboardAnalytics
  leads: {
    summary: {
      total: number
      new: number
      resolved: number
      form: number
      call: number
      responded: number
      avgResponseMinutes: number | null
    }
    items: AdminCompanyLead[]
    nextCursor: string | null
  }
}

export interface UpdateCompanyInput {
  displayName?: string
  legalName?: string
  description?: string
}

export const useAdminStore = defineStore('admin', {
  state: (): AdminState => ({
    stats: null,
    users: [],
    usersTotal: 0,
    filters: { search: '', status: null, role: null, page: 1, pageSize: 20 },
    loadingUsers: false,
    businesses: [],
    businessesTotal: 0,
    businessFilters: { search: '', status: null, campaign: null, page: 1, pageSize: 20 },
    loadingBusinesses: false,
    settings: null,
    categories: [],
    loadingCategories: false,
    invoices: [],
    invoicesTotal: 0,
    invoiceFilters: { search: '', status: null, page: 1, pageSize: 20 },
    loadingInvoices: false,
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

    async fetchBusinesses(): Promise<void> {
      this.loadingBusinesses = true
      try {
        const f = this.businessFilters
        const p = new URLSearchParams()
        if (f.search.trim()) p.set('search', f.search.trim())
        if (f.status) p.set('status', f.status)
        if (f.campaign) p.set('campaign', f.campaign)
        p.set('page', String(f.page))
        p.set('pageSize', String(f.pageSize))
        const res = await apiFetch<{ items: AdminBusinessRow[]; total: number }>(
          `/admin/companies?${p.toString()}`,
        )
        this.businesses = res.items
        this.businessesTotal = res.total
      } finally {
        this.loadingBusinesses = false
      }
    },

    setBusinessFilter<K extends keyof BusinessesFilters>(key: K, value: BusinessesFilters[K]): void {
      this.businessFilters[key] = value
      if (key !== 'page') this.businessFilters.page = 1
      void this.fetchBusinesses()
    },

    async fetchInvoices(): Promise<void> {
      this.loadingInvoices = true
      try {
        const f = this.invoiceFilters
        const p = new URLSearchParams()
        if (f.search.trim()) p.set('search', f.search.trim())
        if (f.status) p.set('status', f.status)
        p.set('page', String(f.page))
        p.set('pageSize', String(f.pageSize))
        const res = await apiFetch<{ items: AdminInvoiceRow[]; total: number }>(
          `/admin/invoices?${p.toString()}`,
        )
        this.invoices = res.items
        this.invoicesTotal = res.total
      } finally {
        this.loadingInvoices = false
      }
    },

    setInvoiceFilter<K extends keyof InvoicesFilters>(key: K, value: InvoicesFilters[K]): void {
      this.invoiceFilters[key] = value
      if (key !== 'page') this.invoiceFilters.page = 1
      void this.fetchInvoices()
    },

    async voidInvoice(id: string, reason: string): Promise<void> {
      await apiFetch(`/admin/invoices/${id}/void`, { method: 'POST', body: { reason } })
      await this.fetchInvoices()
    },

    async unvoidInvoice(id: string): Promise<void> {
      await apiFetch(`/admin/invoices/${id}/unvoid`, { method: 'POST' })
      await this.fetchInvoices()
    },

    async fetchSettings(): Promise<void> {
      this.settings = await apiFetch<AdminSettings>('/admin/settings')
    },

    async updateSettings(input: Partial<AdminSettings>): Promise<void> {
      this.settings = await apiFetch<AdminSettings>('/admin/settings', {
        method: 'PATCH',
        body: input,
      })
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

    blockWallet(id: string, blocked: boolean, reason?: string): Promise<AdminUserDetail> {
      return apiFetch<AdminUserDetail>(`/admin/users/${id}/wallet/block`, {
        method: 'POST',
        body: { blocked, reason },
      })
    },

    adjustWallet(id: string, credits: number, reason: string): Promise<AdminUserDetail> {
      return apiFetch<AdminUserDetail>(`/admin/users/${id}/wallet/adjust`, {
        method: 'POST',
        body: { credits, reason },
      })
    },

    campaignAction(companyId: string, action: CampaignAction): Promise<unknown> {
      return apiFetch(`/admin/companies/${companyId}/campaign`, {
        method: 'POST',
        body: { action },
      })
    },

    setCompanyStatus(companyId: string, status: 'active' | 'suspended'): Promise<unknown> {
      return apiFetch(`/admin/companies/${companyId}/status`, {
        method: 'PATCH',
        body: { status },
      })
    },

    fetchCompany(id: string): Promise<AdminCompanyDetail> {
      return apiFetch<AdminCompanyDetail>(`/admin/companies/${id}`)
    },

    updateCompany(id: string, input: UpdateCompanyInput): Promise<AdminCompanyDetail> {
      return apiFetch<AdminCompanyDetail>(`/admin/companies/${id}`, { method: 'PATCH', body: input })
    },

    saveCompanyCampaign(id: string, input: SaveCampaignInput): Promise<AdminCompanyDetail> {
      return apiFetch<AdminCompanyDetail>(`/admin/companies/${id}/campaign`, {
        method: 'PUT',
        body: input,
      })
    },

    companyLeads(
      id: string,
      params: { status?: string; channel?: string; cursor?: string; limit?: number } = {},
    ): Promise<{ items: AdminCompanyLead[]; nextCursor: string | null }> {
      const p = new URLSearchParams()
      if (params.status) p.set('status', params.status)
      if (params.channel) p.set('channel', params.channel)
      if (params.cursor) p.set('cursor', params.cursor)
      if (params.limit) p.set('limit', String(params.limit))
      const qs = p.toString()
      return apiFetch(`/admin/companies/${id}/leads${qs ? `?${qs}` : ''}`)
    },

    async fetchCategories(): Promise<void> {
      this.loadingCategories = true
      try {
        const res = await apiFetch<{ data: AdminCategoryGroup[] }>('/admin/categories')
        this.categories = res.data
      } finally {
        this.loadingCategories = false
      }
    },

    async createCategory(input: CreateCategoryInput): Promise<void> {
      const res = await apiFetch<{ tree: AdminCategoryGroup[] }>('/admin/categories', {
        method: 'POST',
        body: input,
      })
      this.categories = res.tree
    },

    async updateCategory(id: string, input: UpdateCategoryInput): Promise<void> {
      const res = await apiFetch<{ data: AdminCategoryGroup[] }>(`/admin/categories/${id}`, {
        method: 'PATCH',
        body: input,
      })
      this.categories = res.data
    },

    async deleteCategory(id: string): Promise<void> {
      const res = await apiFetch<{ data: AdminCategoryGroup[] }>(`/admin/categories/${id}`, {
        method: 'DELETE',
      })
      this.categories = res.data
    },
  },
})
