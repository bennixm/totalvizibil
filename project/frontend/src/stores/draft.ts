import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'
import { useAuthStore, type AuthUser } from '@/stores/auth'
import { useCompaniesStore } from '@/stores/companies'

const TOKEN_KEY = 'tvz.draftToken'

// --- Website content model (mirrors backend src/website/website.types.ts) ---

export type SectionType =
  | 'hero'
  | 'about'
  | 'services'
  | 'testimonials'
  | 'faq'
  | 'contact'
  | 'cta'

export interface Section {
  id: string
  type: SectionType
  visible: boolean
  [key: string]: unknown
}

export interface WebsitePage {
  slug: string
  title: string
  isHome: boolean
  sections: Section[]
}

export interface WebsiteContent {
  pages: WebsitePage[]
  seo: { title: string; description: string; schemaType: string }
}

export interface WebsiteTheme {
  palette: 'indigo' | 'emerald' | 'amber' | 'slate' | 'rose'
  fontPair: 'grotesk-inter' | 'serif-sans' | 'mono-sans'
  radius: 'sharp' | 'soft' | 'round'
  density: 'compact' | 'comfortable' | 'spacious'
}

export interface Draft {
  token: string
  mode: 'easy' | 'advanced'
  status: 'generating' | 'ready' | 'claimed' | 'abandoned'
  theme: WebsiteTheme
  content: WebsiteContent
  generator: string
  createdAt: string
  updatedAt: string
}

export interface EasyDraftInput {
  mode: 'easy'
  businessName: string
  businessType: string
  city: string
  services: string[]
  shortDescription: string
}

export interface AdvancedDraftInput {
  mode: 'advanced'
  businessName: string
  businessType: string
  city: string
  region?: string
  services: string[]
  shortDescription: string
  targetAudience?: string
  toneOfVoice?: 'professional' | 'friendly' | 'premium' | 'bold' | 'calm'
  palette?: WebsiteTheme['palette']
  fontPair?: WebsiteTheme['fontPair']
  radius?: WebsiteTheme['radius']
  primaryCta?: string
  includeFaq?: boolean
  includeTestimonials?: boolean
  seoKeywords?: string[]
  phone?: string
  email?: string
}

export type DraftInput = EasyDraftInput | AdvancedDraftInput

interface DraftState {
  token: string | null
  draft: Draft | null
  generating: boolean
  saving: boolean
}

export const useDraftStore = defineStore('draft', {
  state: (): DraftState => ({
    token: localStorage.getItem(TOKEN_KEY),
    draft: null,
    generating: false,
    saving: false,
  }),

  getters: {
    hasDraft: (s): boolean => s.token !== null,
    homePage: (s): WebsitePage | null =>
      s.draft?.content.pages.find((p) => p.isHome) ?? s.draft?.content.pages[0] ?? null,
  },

  actions: {
    persistToken(token: string | null): void {
      this.token = token
      if (token) localStorage.setItem(TOKEN_KEY, token)
      else localStorage.removeItem(TOKEN_KEY)
    },

    async generate(input: DraftInput): Promise<void> {
      this.generating = true
      try {
        const draft = await apiFetch<Draft>('/website-drafts', { method: 'POST', body: input })
        this.draft = draft
        this.persistToken(draft.token)
      } finally {
        this.generating = false
      }
    },

    async load(): Promise<void> {
      if (!this.token) return
      try {
        this.draft = await apiFetch<Draft>(`/website-drafts/${this.token}`)
        if (this.draft.status === 'claimed') this.persistToken(null)
      } catch {
        this.persistToken(null)
        this.draft = null
      }
    },

    async saveContent(content: WebsiteContent): Promise<void> {
      if (!this.token) return
      this.saving = true
      try {
        this.draft = await apiFetch<Draft>(`/website-drafts/${this.token}`, {
          method: 'PATCH',
          body: { content },
        })
      } finally {
        this.saving = false
      }
    },

    async claim(account: { email: string; password: string; name: string }): Promise<{ slug: string }> {
      if (!this.token) throw new Error('No draft to claim')
      const res = await apiFetch<{ user: AuthUser; company: { id: string; slug: string } }>(
        `/website-drafts/${this.token}/claim`,
        { method: 'POST', body: account },
      )
      useAuthStore().$patch({ user: res.user, ready: true })
      useCompaniesStore().reset()
      this.persistToken(null)
      this.draft = null
      return { slug: res.company.slug }
    },

    clear(): void {
      this.persistToken(null)
      this.draft = null
    },
  },
})
