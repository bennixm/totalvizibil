import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'
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
        const created = await apiFetch<CreateResponse>('/website-drafts', { method: 'POST' })
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
          body: { mode: 'advanced', seed },
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
