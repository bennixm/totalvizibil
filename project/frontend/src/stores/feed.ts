import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'
import type { LocalizedName } from '@/stores/companies'

export type FeedSort = 'recommended' | 'newest' | 'rating'

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
  location: { city: string; region: string | null } | null
  services: string[]
  hasWebsite: boolean
  score: number
}

interface FeedResponse {
  items: FeedItem[]
  page: number
  pageSize: number
  total: number
}

interface FeedFilters {
  q: string
  category: string | null
  city: string | null
  sort: FeedSort
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
    filters: { q: '', category: null, city: null, sort: 'recommended' },
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
    hasActiveFilters: (s): boolean =>
      s.filters.q.trim() !== '' || s.filters.category !== null || s.filters.city !== null,
    pageCount: (s): number => Math.max(1, Math.ceil(s.total / s.pageSize)),
  },

  actions: {
    async loadFacets(): Promise<void> {
      if (this.facetsLoaded) return
      this.facets = await apiFetch<FeedFacets>('/feed/facets')
      this.facetsLoaded = true
    },

    query(page: number): string {
      const p = new URLSearchParams()
      const q = this.filters.q.trim()
      if (q) p.set('q', q)
      if (this.filters.category) p.set('category', this.filters.category)
      if (this.filters.city) p.set('city', this.filters.city)
      p.set('sort', this.filters.sort)
      p.set('page', String(page))
      p.set('pageSize', String(this.pageSize))
      return p.toString()
    },

    async loadFeed(): Promise<void> {
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

    /** Change a filter and reset to page 1 (caller triggers the refetch). */
    setFilter<K extends keyof FeedFilters>(key: K, value: FeedFilters[K]): void {
      this.filters[key] = value
      this.page = 1
    },

    reset(): void {
      this.filters = { q: '', category: null, city: null, sort: 'recommended' }
    },
  },
})
