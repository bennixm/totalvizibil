import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'
import type { LocalizedName } from '@/stores/companies'

export type FeedSort = 'recommended' | 'newest' | 'rating'

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
  facets: FeedFacets
  facetsLoaded: boolean
}

/**
 * The results grid is being rebuilt from scratch — for now this store only
 * backs the discovery filter bar (search + categories + city + sort).
 */
export const useFeedStore = defineStore('feed', {
  state: (): FeedState => ({
    filters: { q: '', category: null, city: null, sort: 'recommended' },
    facets: { categories: [], cities: [] },
    facetsLoaded: false,
  }),

  getters: {
    hasActiveFilters: (s): boolean =>
      s.filters.q.trim() !== '' || s.filters.category !== null || s.filters.city !== null,
  },

  actions: {
    async loadFacets(): Promise<void> {
      if (this.facetsLoaded) return
      this.facets = await apiFetch<FeedFacets>('/feed/facets')
      this.facetsLoaded = true
    },

    setFilter<K extends keyof FeedFilters>(key: K, value: FeedFilters[K]): void {
      this.filters[key] = value
    },

    reset(): void {
      this.filters = { q: '', category: null, city: null, sort: 'recommended' }
    },
  },
})
