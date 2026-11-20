import { defineStore } from 'pinia'

import { googleAdsUserApi, type UserCampaignSummary } from '@/services/googleAdsUser'

/**
 * The signed-in user's Google Ads campaigns managed by the optimization
 * agent. Shared by the panel's campaign switcher (next to businesses) and
 * the sidebar navigation of the Google Ads dashboard.
 */
export const useGoogleAdsUserStore = defineStore('googleAdsUser', {
  state: () => ({
    campaigns: [] as UserCampaignSummary[],
    loaded: false,
  }),
  actions: {
    async fetch(force = false): Promise<void> {
      if (this.loaded && !force) return
      try {
        this.campaigns = await googleAdsUserApi.list()
      } catch {
        /* not signed in / offline: the switcher just shows businesses */
      } finally {
        this.loaded = true
      }
    },
    reset(): void {
      this.campaigns = []
      this.loaded = false
    },
  },
})
