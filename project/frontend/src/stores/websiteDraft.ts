import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'
import { i18n } from '@/plugins/i18n'
import type { WebsiteContent, WebsiteTheme } from '@/types/website'

export interface DraftTurn {
  role: 'assistant' | 'user'
  /** assistant turns: i18n key resolved under `studio.msg.*` */
  key?: string
  /** user turns: the raw message */
  text?: string
  at: string
}

export interface DraftLocation {
  /** Null when `nationwide` — whole-country coverage has no fixed city. */
  city: string | null
  region: string | null
  country: string
  lat: number | null
  lng: number | null
  radiusKm: number | null
  /** Serves the whole country — no city or radius applies. */
  nationwide: boolean
}

export interface EasyServiceCopy {
  name: string
  description: string
  icon?: string
}

export interface EasyTestimonial {
  quote: string
  author?: string
}
export interface EasyFaq {
  q: string
  a: string
}
export interface EasyStat {
  value: string
  label: string
}
export interface EasyProcessStep {
  title: string
  text?: string
}

/** Guided-answer snapshot the "Site Simplu" studio widgets prefill from. */
export interface EasyBlock {
  companyName: string
  businessType: string
  landingTitle: string
  landingSubtitle: string
  accentColor: string | null
  landingImage: string | null
  serviceNames: string[]
  services: EasyServiceCopy[]
  portfolio: string[]
  phone: string
  email: string
  city: string
  about: string
  showAbout: boolean
  stats: EasyStat[]
  showStats: boolean
  whyUs: string[]
  showWhyUs: boolean
  process: EasyProcessStep[]
  showProcess: boolean
  testimonials: EasyTestimonial[]
  faq: EasyFaq[]
  ctaHeadline: string
  ctaButton: string
  showCta: boolean
  hours: string
  template: EasyTemplate
  autoGrammar: boolean
  locale: 'ro' | 'en' | 'de'
  aiCalls: number
}

export type EasyTemplate = 'classic' | 'bold' | 'minimal'

export type EasyStep =
  | 'template'
  | 'name'
  | 'field'
  | 'color'
  | 'landing'
  | 'services'
  | 'portfolio'
  | 'contact'
  | 'done'

/** Fields the studio widgets can patch without spending a chat turn. */
export interface EasyPatch {
  accentColor?: string
  landingTitle?: string
  landingSubtitle?: string
  landingImage?: string
  portfolio?: string[]
  services?: EasyServiceCopy[]
  phone?: string
  email?: string
  city?: string
  about?: string
  showAbout?: boolean
  stats?: EasyStat[]
  showStats?: boolean
  whyUs?: string[]
  showWhyUs?: boolean
  process?: EasyProcessStep[]
  showProcess?: boolean
  testimonials?: EasyTestimonial[]
  faq?: EasyFaq[]
  ctaHeadline?: string
  ctaButton?: string
  showCta?: boolean
  hours?: string
  template?: 'classic' | 'bold' | 'minimal'
  autoGrammar?: boolean
}

export interface WebsiteDraftView {
  id: string
  mode: 'easy' | 'advanced'
  plan: string
  status: string
  step: string
  turnsUsed: number
  maxTurns: number
  turnsLeft: number
  capReached: boolean
  complete: boolean
  transcript: DraftTurn[]
  theme: WebsiteTheme | null
  content: WebsiteContent | null
  generator: string | null
  ready: boolean
  easy: EasyBlock | null
  categorySlug: string | null
  location: DraftLocation | null
  updatedAt: string
}

export interface SetLocationInput {
  categorySlug: string
  city?: string
  region?: string
  country?: string
  lat?: number
  lng?: number
  radiusKm?: number
  nationwide?: boolean
}

interface CreateResponse {
  id: string
  token: string
  draft: WebsiteDraftView
}

/** The draft is anonymous — we hold its id + opaque token in localStorage. */
const LS_KEY = 'tvz.websiteDraft'

interface DraftRef {
  id: string
  token: string
}

function loadRef(): DraftRef | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DraftRef>
    return parsed.id && parsed.token ? { id: parsed.id, token: parsed.token } : null
  } catch {
    return null
  }
}

function saveRef(ref: DraftRef): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ref))
  } catch {
    /* private mode / storage disabled — the draft just won't resume next visit */
  }
}

function clearRef(): void {
  try {
    localStorage.removeItem(LS_KEY)
  } catch {
    /* ignore */
  }
}

interface State {
  draft: WebsiteDraftView | null
  loading: boolean
  sending: boolean
  error: string
}

export const useWebsiteDraftStore = defineStore('websiteDraft', {
  state: (): State => ({
    draft: null,
    loading: false,
    sending: false,
    error: '',
  }),

  getters: {
    /** The opaque draft token, if a draft is in progress on this device. */
    token: (): string | null => loadRef()?.token ?? null,
  },

  actions: {
    /**
     * Load a stored draft if one exists on this device — never creates one.
     * Returns true if a draft is now loaded.
     */
    async resumeIfAny(): Promise<boolean> {
      if (this.draft) return true
      const ref = loadRef()
      if (!ref) return false
      this.loading = true
      try {
        const draft = await apiFetch<WebsiteDraftView>(`/website-drafts/${ref.id}`, {
          headers: { 'X-Draft-Token': ref.token },
        })
        // A draft that was already turned into a company is spent — drop the
        // stale local reference so it can't resurrect the pre-account flow.
        if (draft.status === 'claimed') {
          clearRef()
          return false
        }
        this.draft = draft
        return true
      } catch {
        clearRef()
        return false
      } finally {
        this.loading = false
      }
    },

    /** Resume a stored draft, or start a fresh one. */
    async resumeOrCreate(): Promise<void> {
      if (this.draft) return
      this.loading = true
      this.error = ''
      try {
        const ref = loadRef()
        if (ref) {
          try {
            this.draft = await apiFetch<WebsiteDraftView>(`/website-drafts/${ref.id}`, {
              headers: { 'X-Draft-Token': ref.token },
            })
            return
          } catch {
            clearRef()
          }
        }
        const created = await apiFetch<CreateResponse>('/website-drafts', {
          method: 'POST',
          body: { locale: i18n.global.locale.value },
        })
        saveRef({ id: created.id, token: created.token })
        this.draft = created.draft
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
      } finally {
        this.loading = false
      }
    },

    async send(text: string): Promise<void> {
      const ref = loadRef()
      const message = text.trim()
      if (!ref || !message || this.sending) return
      this.sending = true
      this.error = ''
      try {
        this.draft = await apiFetch<WebsiteDraftView>(`/website-drafts/${ref.id}/messages`, {
          method: 'POST',
          headers: { 'X-Draft-Token': ref.token },
          body: { text: message },
        })
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
      } finally {
        this.sending = false
      }
    },

    /** Guided widget step advance (colour / portfolio → "Continue"). */
    async advanceEasy(): Promise<void> {
      const ref = loadRef()
      if (!ref || this.sending) return
      this.sending = true
      this.error = ''
      try {
        this.draft = await apiFetch<WebsiteDraftView>(`/website-drafts/${ref.id}/advance`, {
          method: 'POST',
          headers: { 'X-Draft-Token': ref.token },
        })
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
      } finally {
        this.sending = false
      }
    },

    /** Live config edit from a studio widget — colour, image, contact, order. */
    async patchEasy(patch: EasyPatch): Promise<void> {
      const ref = loadRef()
      if (!ref) return
      this.error = ''
      try {
        this.draft = await apiFetch<WebsiteDraftView>(`/website-drafts/${ref.id}/easy`, {
          method: 'PATCH',
          headers: { 'X-Draft-Token': ref.token },
          body: { ...patch, locale: i18n.global.locale.value },
        })
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
      }
    },

    /** Upload a landing / portfolio image (base64 data-URI). Returns its URL. */
    async uploadAsset(kind: 'landing' | 'portfolio', dataUri: string): Promise<string | null> {
      const ref = loadRef()
      if (!ref) return null
      this.error = ''
      try {
        const res = await apiFetch<{ id: string; url: string }>(
          `/website-drafts/${ref.id}/assets`,
          {
            method: 'POST',
            headers: { 'X-Draft-Token': ref.token },
            body: { dataUri, kind },
            timeoutMs: 30_000,
          },
        )
        return res.url
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
        return null
      }
    },

    /** Re-run the single AI call for a new/edited list of service names. */
    async regenerateServices(names: string[]): Promise<void> {
      const ref = loadRef()
      if (!ref || this.sending) return
      this.sending = true
      this.error = ''
      try {
        this.draft = await apiFetch<WebsiteDraftView>(`/website-drafts/${ref.id}/services`, {
          method: 'POST',
          headers: { 'X-Draft-Token': ref.token },
          body: { names },
          timeoutMs: 30_000,
        })
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
      } finally {
        this.sending = false
      }
    },

    /** Fix spelling / grammar in a manual prose string (grammar toggle on). */
    async proofread(text: string): Promise<string> {
      const ref = loadRef()
      const src = text.trim()
      if (!ref || !src) return text
      try {
        const res = await apiFetch<{ text: string }>(`/website-drafts/${ref.id}/proofread`, {
          method: 'POST',
          headers: { 'X-Draft-Token': ref.token },
          body: { text: src },
          timeoutMs: 25_000,
        })
        return res.text || text
      } catch {
        return text
      }
    },

    /** Save the location step (M2). */
    async setLocation(input: SetLocationInput): Promise<boolean> {
      const ref = loadRef()
      if (!ref) return false
      this.error = ''
      try {
        this.draft = await apiFetch<WebsiteDraftView>(`/website-drafts/${ref.id}/location`, {
          method: 'PATCH',
          headers: { 'X-Draft-Token': ref.token },
          body: input,
        })
        return true
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
        return false
      }
    },

    /** Abandon the current draft and start over on next open. */
    async restart(): Promise<void> {
      clearRef()
      this.draft = null
      this.error = ''
      await this.resumeOrCreate()
    },

    /** Start an advanced-plan draft from the info gate (business name only). */
    async createAdvanced(seed: { businessName: string }): Promise<boolean> {
      this.loading = true
      this.error = ''
      try {
        const created = await apiFetch<CreateResponse>('/website-drafts', {
          method: 'POST',
          body: { mode: 'advanced', seed, locale: i18n.global.locale.value },
        })
        saveRef({ id: created.id, token: created.token })
        this.draft = created.draft
        return true
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
        return false
      } finally {
        this.loading = false
      }
    },

    /** Drop the local draft reference after it has been claimed into a company. */
    clearAfterClaim(): void {
      clearRef()
      this.draft = null
      this.error = ''
    },
  },
})
