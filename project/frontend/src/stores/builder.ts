import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'
import type { DraftTurn } from '@/stores/websiteDraft'
import type { Money } from '@/stores/wallet'
import type { WebsiteContent, WebsiteTheme } from '@/types/website'

export interface BuilderView {
  /** `easy` here means the site is upgrading to the advanced plan. */
  mode: 'easy' | 'advanced'
  unlocked: boolean
  priceCredits: number
  wallet: { balance: Money }
  websiteStatus: 'draft' | 'published' | 'unpublished'
  step: string
  complete: boolean
  transcript: DraftTurn[]
  theme: WebsiteTheme | null
  content: WebsiteContent | null
}

interface State {
  data: BuilderView | null
  loading: boolean
  working: boolean
  error: string
}

export const useBuilderStore = defineStore('builder', {
  state: (): State => ({ data: null, loading: false, working: false, error: '' }),

  actions: {
    async load(companyId: string): Promise<void> {
      this.loading = true
      this.error = ''
      try {
        this.data = await apiFetch<BuilderView>(`/companies/${companyId}/website-builder`)
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
      } finally {
        this.loading = false
      }
    },

    async unlock(companyId: string): Promise<boolean> {
      return this.run(() =>
        apiFetch<BuilderView>(`/companies/${companyId}/website-builder/unlock`, { method: 'POST' }),
      )
    },

    async send(companyId: string, text: string): Promise<void> {
      const message = text.trim()
      if (!message) return
      await this.run(() =>
        apiFetch<BuilderView>(`/companies/${companyId}/website-builder/messages`, {
          method: 'POST',
          body: { text: message },
        }),
      )
    },

    async run(fn: () => Promise<BuilderView>): Promise<boolean> {
      this.working = true
      this.error = ''
      try {
        this.data = await fn()
        return true
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
        return false
      } finally {
        this.working = false
      }
    },
  },
})
