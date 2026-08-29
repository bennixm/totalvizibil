import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'

export type CompanyRole = 'owner' | 'manager' | 'editor' | 'billing'
export type CompanyStatus = 'draft' | 'active' | 'suspended'

export interface LocalizedName {
  ro: string
  en: string
  de: string
}

export interface CompanyCategory {
  id: string
  slug: string
  name: LocalizedName
  icon?: string | null
}

export interface CompanyLocation {
  id: string
  city: string
  address: string | null
  region: string | null
  country: string
  isPrimary: boolean
  serviceRadiusKm: number | null
}

export interface CompanyContact {
  id: string
  type: 'phone' | 'whatsapp' | 'email' | 'url'
  value: string
  isPublic: boolean
}

export interface CompanyService {
  id: string
  name: string
  description: string | null
  position: number
}

export interface Company {
  id: string
  displayName: string
  legalName: string | null
  slug: string
  description: string | null
  logoUrl: string | null
  status: CompanyStatus
  country: string
  defaultLocale: string
  currency: string
  createdAt: string
  updatedAt: string
  viewerRole: CompanyRole | null
  category: { id: string; slug: string; name: LocalizedName } | null
  locations: CompanyLocation[]
  contacts: CompanyContact[]
  services: CompanyService[]
}

export interface DashboardPayload {
  company: {
    id: string
    displayName: string
    slug: string
    status: CompanyStatus
    category: { id: string; slug: string; name: LocalizedName } | null
    primaryLocation: CompanyLocation | null
    contactsCount: number
    servicesCount: number
    createdAt: string
    viewerRole: CompanyRole | null
  }
  profileCompleteness: { score: number; missing: string[] }
  website: { status: string; _status: string; note: string }
  metrics: {
    _status: string
    note: string
    impressions: number | null
    clicks: number | null
    ctr: number | null
    averageCpc: number | null
    totalSpent: number | null
    remainingBalance: number | null
    websiteVisitors: number | null
    leads: number | null
  }
}

export interface CreateCompanyInput {
  displayName: string
  description?: string
  categoryId?: string
  phone?: string
  email?: string
  location?: { city: string; region?: string; address?: string }
  services?: { name: string }[]
}

interface CompaniesState {
  list: Company[]
  loaded: boolean
}

export const useCompaniesStore = defineStore('companies', {
  state: (): CompaniesState => ({
    list: [],
    loaded: false,
  }),

  getters: {
    hasCompany: (state): boolean => state.list.length > 0,
    primary: (state): Company | null => state.list[0] ?? null,
  },

  actions: {
    async fetchList(): Promise<void> {
      const { data } = await apiFetch<{ data: Company[] }>('/companies')
      this.list = data
      this.loaded = true
    },

    async ensureLoaded(): Promise<void> {
      if (!this.loaded) await this.fetchList()
    },

    async create(input: CreateCompanyInput): Promise<Company> {
      const company = await apiFetch<Company>('/companies', { method: 'POST', body: input })
      this.list = [company, ...this.list]
      this.loaded = true
      return company
    },

    fetchDashboard(companyId: string): Promise<DashboardPayload> {
      return apiFetch<DashboardPayload>(`/companies/${companyId}/dashboard`)
    },

    reset(): void {
      this.list = []
      this.loaded = false
    },
  },
})
