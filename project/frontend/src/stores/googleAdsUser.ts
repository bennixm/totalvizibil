import { defineStore } from 'pinia'

import { googleAdsUserApi, type UserCampaignSummary } from '@/services/googleAdsUser'

const SELECTED_KEY = 'tvz.adsCampaign.v1'
function readSelected(): string {
  try {
    return localStorage.getItem(SELECTED_KEY) ?? ''
  } catch {
    return ''
  }
}

/**
 * The signed-in user's Google Ads campaigns managed by the optimization
 * agent. Shared by the panel's campaign switcher (next to businesses) and
 * the sidebar navigation of the Google Ads dashboard.
 */
export const useGoogleAdsUserStore = defineStore('googleAdsUser', {
  state: () => ({
    campaigns: [] as UserCampaignSummary[],
    loaded: false,
    failed: false,
    /** Last opened campaign: stays the selected one on the area's other pages. */
    selectedId: readSelected(),
  }),
  getters: {
    selected: (s): UserCampaignSummary | null => s.campaigns.find((c) => c.id === s.selectedId) ?? null,
  },
  actions: {
    async fetch(force = false): Promise<void> {
      if (this.loaded && !force) return
      try {
        this.campaigns = await googleAdsUserApi.list()
        this.failed = false
      } catch {
        this.failed = true
      } finally {
        this.loaded = true
      }
    },
    select(id: string): void {
      this.selectedId = id
      try {
        localStorage.setItem(SELECTED_KEY, id)
      } catch {
        /* storage unavailable: kept for this page view */
      }
    },
    reset(): void {
      this.selectedId = ''
      try {
        localStorage.removeItem(SELECTED_KEY)
      } catch {
        /* storage unavailable */
      }
      this.campaigns = []
      this.loaded = false
    },
  },
})
