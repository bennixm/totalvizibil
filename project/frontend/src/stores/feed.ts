import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'
import type { LocalizedName } from '@/stores/companies'

export interface FeedCategoryLeaf {
  slug: string
  name: LocalizedName
  icon: string | null
}
export interface FeedCategoryNode extends FeedCategoryLeaf {
  children: FeedCategoryLeaf[]
}

export interface FeedFacets {
  categories: FeedCategoryNode[]
  cities: string[]
}

export interface FeedItem {
  id: string
  slug: string
  displayName: string
  description: string | null
  logoUrl: string | null
  category:
    | {
        slug: string
        name: LocalizedName
        icon: string | null
        parent: { slug: string; name: LocalizedName } | null
      }
    | null
  /**
   * `radiusKm` = the coverage radius the business set for its own location;
   * `nationwide` = it serves the whole country (no radius applies).
   */
  location: {
    /** Null when `nationwide` — whole-country coverage has no fixed city. */
    city: string | null
    region: string | null
    radiusKm: number | null
    nationwide: boolean
  } | null
  services: string[]
  servicesTotal: number
  hasWebsite: boolean
  /** Landing headline / sub / visual + theme accent from the generated site. */
  heroTitle: string | null
  heroSubtitle: string | null
  heroImage: string | null
  /** The site was made with the Advanced builder → featured ("own website") card. */
  builtWithBuilder: boolean
  accent: string | null
  score: number
}

interface FeedResponse {
  items: FeedItem[]
  page: number
  pageSize: number
  total: number
  requiresCategory: boolean
}

export interface FeedArea {
  city: string
  lat: number
  lng: number
}

interface FeedFilters {
  category: string | null
  /** Selected city — a business shows if that city is inside its coverage radius. */
  area: FeedArea | null
}

interface FeedState {
  filters: FeedFilters
  facets: FeedFacets
  facetsLoaded: boolean
  items: FeedItem[]
  page: number
  pageSize: number
  total: number
  loading: boolean
  loaded: boolean
  error: string
}

const PAGE_SIZE = 8

export const useFeedStore = defineStore('feed', {
  state: (): FeedState => ({
    filters: { category: null, area: null },
    facets: { categories: [], cities: [] },
    facetsLoaded: false,
    items: [],
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    loading: false,
    loaded: false,
    error: '',
  }),

  getters: {
    hasActiveFilters: (s): boolean => s.filters.category !== null || s.filters.area !== null,
    pageCount: (s): number => Math.max(1, Math.ceil(s.total / s.pageSize)),
    /** Discovery is category-first — nothing lists until one is picked. */
    requiresCategory: (s): boolean => s.filters.category === null,
  },

  actions: {
    async loadFacets(): Promise<void> {
      if (this.facetsLoaded) return
      this.facets = await apiFetch<FeedFacets>('/feed/facets')
      this.facetsLoaded = true
    },

    query(page: number): string {
      const p = new URLSearchParams()
      if (this.filters.category) p.set('category', this.filters.category)
      if (this.filters.area) {
        p.set('city', this.filters.area.city)
        p.set('lat', String(this.filters.area.lat))
        p.set('lng', String(this.filters.area.lng))
      }
      p.set('page', String(page))
      p.set('pageSize', String(this.pageSize))
      return p.toString()
    },

    async loadFeed(): Promise<void> {
      // No category → nothing to fetch. The view shows the category picker.
      if (!this.filters.category) {
        this.items = []
        this.total = 0
        this.page = 1
        this.error = ''
        this.loaded = true
        this.loading = false
        return
      }
      this.loading = true
      this.error = ''
      try {
        const res = await apiFetch<FeedResponse>(`/feed?${this.query(this.page)}`)
        this.items = res.items
        this.page = res.page
        this.total = res.total
        this.loaded = true
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
        this.items = []
      } finally {
        this.loading = false
      }
    },

    async goToPage(n: number): Promise<void> {
      const target = Math.min(Math.max(1, n), this.pageCount)
      if (target === this.page) return
      this.page = target
      await this.loadFeed()
    },

    setCategory(slug: string | null): void {
      this.filters.category = slug
      this.page = 1
    },

    setArea(area: FeedArea | null): void {
      this.filters.area = area
      this.page = 1
    },

    reset(): void {
      this.filters = { category: null, area: null }
      this.page = 1
    },
  },
})
