import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'
import type { WebsiteContent, WebsiteTheme } from '@/types/website'
import type { WalletSummary } from '@/stores/wallet'
import type { CampaignData } from '@/stores/campaign'

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
  /** Null when `nationwide` — whole-country coverage has no fixed city. */
  city: string | null
  address: string | null
  region: string | null
  country: string
  lat: number | null
  lng: number | null
  isPrimary: boolean
  serviceRadiusKm: number | null
  /** Serves the whole country — no radius applies. */
  nationwide: boolean
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
  advancedUnlockedAt: string | null
  /** Set once the owner requests deletion; the record is wiped after the grace window. */
  deletionScheduledAt: string | null
  /** When the record is actually wiped unless the owner cancels first. */
  deletionEffectiveAt: string | null
  createdAt: string
  updatedAt: string
  viewerRole: CompanyRole | null
  category: { id: string; slug: string; name: LocalizedName } | null
  locations: CompanyLocation[]
  contacts: CompanyContact[]
  services: CompanyService[]
}

export interface DashboardLeadsSummary {
  total: number
  new: number
  resolved: number
  form: number
  call: number
  responded: number
  avgResponseMinutes: number | null
}

export interface FeedRank {
  position: number
  total: number
}

export interface DashboardAnalytics {
  planMode: string | null
  /** Feed position in the company's category group — null when not live. */
  feedRank: FeedRank | null
  clicks: { total: number; today: number }
  calls: { total: number }
  messages: { total: number; new: number }
  campaign: {
    consumedTotal: { minor: number; credits: number }
    consumedToday: { minor: number; credits: number }
    activeDays: number
  }
  response: {
    avgMinutes: number | null
    ratePct: number | null
    responded: number
    total: number
  }
  visibility: {
    score: number
    parts: { cpc: number; response: number; plan: number; age: number }
    weights: { cpc: number; response: number; plan: number; age: number }
  }
  series: { days: string[]; clicks: number[]; messages: number[] }
}

export interface DashboardPayload {
  wallet: WalletSummary
  campaign: CampaignData | null
  leads: DashboardLeadsSummary
  analytics: DashboardAnalytics
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
    deletionScheduledAt: string | null
    deletionEffectiveAt: string | null
  }
  website:
    | { status: 'none' }
    | {
        status: 'draft' | 'published' | 'unpublished'
        mode: 'easy' | 'advanced'
        generator: string
        updatedAt: string
        isLive: boolean
        theme: WebsiteTheme
        content: WebsiteContent
      }
  tasks: {
    key: string
    required: boolean
    status: 'todo' | 'blocked' | 'done'
  }[]
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

export interface CompanyOverview {
  id: string
  displayName: string
  slug: string
  status: CompanyStatus
  website: { mode: 'easy' | 'advanced'; status: 'draft' | 'published' | 'unpublished' } | null
  campaignStatus: 'draft' | 'active' | 'paused' | 'depleted' | null
  /** Lifetime credits this business's campaign has consumed. */
  consumedCredits: number
  locationCity: string | null
  /** Set once the owner requests deletion of the whole business. */
  deletionScheduledAt: string | null
  deletionEffectiveAt: string | null
}

const CURRENT_KEY = 'tvz.currentCompany'
function loadCurrent(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY)
  } catch {
    return null
  }
}

interface CompaniesState {
  list: Company[]
  loaded: boolean
  overview: CompanyOverview[]
  overviewLoaded: boolean
  currentId: string | null
}

export const useCompaniesStore = defineStore('companies', {
  state: (): CompaniesState => ({
    list: [],
    loaded: false,
    overview: [],
    overviewLoaded: false,
    currentId: loadCurrent(),
  }),

  getters: {
    hasCompany: (state): boolean => state.list.length > 0 || state.overview.length > 0,
    primary: (state): Company | null => state.list[0] ?? null,
    /** The company the dashboard/sub-pages act on: sticky selection, else the first. */
    currentOverview: (state): CompanyOverview | null =>
      state.overview.find((c) => c.id === state.currentId) ?? state.overview[0] ?? null,
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

    async fetchOverview(force = false): Promise<void> {
      if (this.overviewLoaded && !force) return
      const { data } = await apiFetch<{ data: CompanyOverview[] }>('/companies/overview')
      this.overview = data
      this.overviewLoaded = true
      if (!this.currentId || !data.some((c) => c.id === this.currentId)) {
        this.currentId = data[0]?.id ?? null
      }
    },

    /** Pick the active company (sticky across pages). */
    select(id: string | null): void {
      this.currentId = id
      try {
        if (id) localStorage.setItem(CURRENT_KEY, id)
        else localStorage.removeItem(CURRENT_KEY)
      } catch {
        /* ignore */
      }
    },

    /**
     * Schedule a business for deletion. The listing is taken down at once but
     * the record is wiped only after a 7-day grace window — the owner can
     * `cancelDeletion` until then, so we keep it in the local lists.
     */
    async remove(companyId: string): Promise<void> {
      await apiFetch(`/companies/${companyId}`, { method: 'DELETE' })
      await this.fetchOverview(true)
    },

    /** Call off a pending deletion (inside the grace window). */
    async cancelDeletion(companyId: string): Promise<void> {
      await apiFetch(`/companies/${companyId}/deletion`, { method: 'DELETE' })
      await this.fetchOverview(true)
    },

    /** Resolve a company id: explicit route param → sticky selection → first. */
    resolveId(routeC?: unknown): string | null {
      const wanted = typeof routeC === 'string' ? routeC : null
      const id =
        wanted ??
        this.currentId ??
        this.overview[0]?.id ??
        this.list[0]?.id ??
        null
      if (id) this.select(id)
      return id
    },

    async create(input: CreateCompanyInput): Promise<Company> {
      const company = await apiFetch<Company>('/companies', { method: 'POST', body: input })
      this.list = [company, ...this.list]
      this.loaded = true
      return company
    },

    /** Claim an anonymous website draft into a real company (end of create flow). */
    async createFromDraft(draftToken: string): Promise<Company> {
      const company = await apiFetch<Company>('/companies/from-draft', {
        method: 'POST',
        body: { draftToken },
      })
      this.list = [company, ...this.list]
      this.loaded = true
      this.overviewLoaded = false
      this.select(company.id)
      return company
    },

    fetchDashboard(companyId: string): Promise<DashboardPayload> {
      return apiFetch<DashboardPayload>(`/companies/${companyId}/dashboard`)
    },

    fetchOne(companyId: string): Promise<Company> {
      return apiFetch<Company>(`/companies/${companyId}`)
    },

    async updateLocation(
      companyId: string,
      input: {
        categorySlug: string
        city?: string
        region?: string
        country?: string
        lat?: number
        lng?: number
        radiusKm?: number
        nationwide?: boolean
      },
    ): Promise<Company> {
      const company = await apiFetch<Company>(`/companies/${companyId}/location`, {
        method: 'PATCH',
        body: input,
      })
      const i = this.list.findIndex((c) => c.id === companyId)
      if (i >= 0) this.list[i] = company
      return company
    },

    setPublished(companyId: string, live: boolean): Promise<DashboardPayload> {
      return apiFetch<DashboardPayload>(
        `/companies/${companyId}/${live ? 'publish' : 'unpublish'}`,
        { method: 'POST' },
      )
    },

    reset(): void {
      this.list = []
      this.loaded = false
    },
  },
})
