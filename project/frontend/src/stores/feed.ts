import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'
import type { LocalizedName } from '@/stores/companies'

export type Placement = 'sponsored' | 'organic' | 'exploration'
export type FeedSort = 'recommended' | 'newest' | 'rating'

export interface FeedItem {
  id: string
  slug: string
  displayName: string
  description: string | null
  logoUrl: string | null
  placement: Placement
  category: { slug: string; name: LocalizedName; icon: string | null } | null
  location: { city: string; region: string | null } | null
  services: string[]
  hasWebsite: boolean
  score: number
  scoreBreakdown: { relevance: number; quality: number; popularity: number; freshness: number }
}

export interface FeedResponse {
  items: FeedItem[]
  page: number
  pageSize: number
  total: number
  appliedFilters: { q: string | null; category: string | null; city: string | null; sort: FeedSort }
  _ranking: string
}

export interface FeedFacets {
  categories: { slug: string; name: LocalizedName; icon: string | null }[]
  cities: string[]
}

interface FeedFilters {
  q: string
  category: string | null
  city: string | null
  sort: FeedSort
}

interface FeedState {
  filters: FeedFilters
  items: FeedItem[]
  total: number
  page: number
  pageSize: number
  rankingNote: string
  facets: FeedFacets
  loading: boolean
  loaded: boolean
}

export const useFeedStore = defineStore('feed', {
  state: (): FeedState => ({
    filters: { q: '', category: null, city: null, sort: 'recommended' },
    items: [],
    total: 0,
    page: 1,
    pageSize: 12,
    rankingNote: '',
    facets: { categories: [], cities: [] },
    loading: false,
    loaded: false,
  }),

  getters: {
    hasActiveFilters: (s): boolean =>
      s.filters.q.trim() !== '' || s.filters.category !== null || s.filters.city !== null,
  },

  actions: {
    async loadFacets(): Promise<void> {
      this.facets = await apiFetch<FeedFacets>('/feed/facets')
    },

    async load(page = 1): Promise<void> {
      this.loading = true
      try {
        const params = new URLSearchParams()
        if (this.filters.q.trim()) params.set('q', this.filters.q.trim())
        if (this.filters.category) params.set('category', this.filters.category)
        if (this.filters.city) params.set('city', this.filters.city)
        params.set('sort', this.filters.sort)
        params.set('page', String(page))
        params.set('pageSize', String(this.pageSize))

        const res = await apiFetch<FeedResponse>(`/feed?${params.toString()}`)
        this.items = res.items
        this.total = res.total
        this.page = res.page
        this.rankingNote = res._ranking
        this.loaded = true
      } finally {
        this.loading = false
      }
    },

    setFilter<K extends keyof FeedFilters>(key: K, value: FeedFilters[K]): void {
      this.filters[key] = value
      void this.load(1)
    },

    reset(): void {
      this.filters = { q: '', category: null, city: null, sort: 'recommended' }
      void this.load(1)
    },
  },
})
