import { defineStore } from 'pinia'

import { apiFetch, ApiError } from '@/services/api'
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
  /** One or several județe — empty while `nationwide`. */
  counties: string[]
  country: string
  lat: number | null
  lng: number | null
  /** Serves the whole country — no județe apply. */
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
export interface EasySocialLink {
  label: string
  url: string
}

/** Guided-answer snapshot the "Site Simplu" studio widgets prefill from. */
export interface EasyBlock {
  companyName: string
  businessType: string
  landingTitle: string
  landingSubtitle: string
  accentColor: string | null
  landingImage: string | null
  logoUrl: string | null
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
  navShowLogo: boolean
  navCtaLabel: string
  navCtaTarget: string
  footerTagline: string
  footerShowContact: boolean
  footerSocials: EasySocialLink[]
  template: EasyTemplate
  autoGrammar: boolean
  locale: 'ro' | 'en' | 'de'
  aiCalls: number
}

export type EasyTemplate = 'classic' | 'bold' | 'minimal'

/**
 * Mirrors `AI_CALL_CAP` in the backend (`website-draft.service.ts` and
 * `easy-site.service.ts`, both 4). Past this many AI calls, the
 * service-copy endpoint still returns 200 but quietly serves deterministic
 * rule-based copy instead of AI copy — the owner needs to be told, since
 * nothing else about the response changes.
 */
export const EASY_AI_CALL_CAP = 4

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
  logoUrl?: string
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
  navShowLogo?: boolean
  navCtaLabel?: string
  navCtaTarget?: string
  footerTagline?: string
  footerShowContact?: boolean
  footerSocials?: EasySocialLink[]
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
  categorySlugs: string[]
  location: DraftLocation | null
  updatedAt: string
}

export interface SetLocationInput {
  categorySlugs: string[]
  counties?: string[]
  city?: string
  country?: string
  lat?: number
  lng?: number
  nationwide?: boolean
}

/** One finding from the end-of-setup AI review of the owner's texts. */
export interface DraftIssue {
  key: string
  label: string
  kind: 'meaning' | 'grammar' | 'profanity' | 'other'
  message: string
}
interface ReviewResponse {
  issues: DraftIssue[]
  draft: WebsiteDraftView
}

/**
 * The outcome of `reviewDraft()`. An empty `issues` array used to be returned
 * for BOTH "the AI reviewed everything and found nothing" and "the review
 * never ran" — which rendered a green all-clear over a review that never
 * happened. The two are now distinct shapes so the caller cannot conflate
 * them: only `ok: true` means the text was actually checked.
 */
export type DraftReviewResult =
  | { ok: true; issues: DraftIssue[] }
  | { ok: false; code: string }

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
  /** A restart (discard + create a fresh draft) is in flight. */
  restarting: boolean
  error: string
}

/** A 429 (the studio's create/restart and per-step throttles) gets one normalized code. */
function draftErrorCode(err: unknown): string {
  if (err instanceof ApiError && err.status === 429) return 'rate_limited'
  if (isUnreachable(err)) return 'unreachable'
  return err instanceof Error ? err.message : 'error'
}

/**
 * Did the server actually CONFIRM this draft is gone? Only a 404 (the
 * backend's "Draft not found" / "Draft expired") and a 410 mean the local
 * reference is genuinely dead. A network error, a client-side timeout
 * (ApiError status 0) or any 5xx says nothing about the draft — it is still
 * safely on the server, so the local reference must survive.
 */
function isConfirmedGone(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 410)
}

/** A transient failure: the request never got a verdict from the backend. */
function isUnreachable(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 0 || err.status >= 500)
}

export const useWebsiteDraftStore = defineStore('websiteDraft', {
  state: (): State => ({
    draft: null,
    loading: false,
    sending: false,
    restarting: false,
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
      } catch (err) {
        // ONLY a confirmed-gone draft may drop the local reference. A network
        // blip or a 5xx used to take the same path, silently discarding a
        // finished one-pager that was still safe server-side.
        if (isConfirmedGone(err)) {
          clearRef()
          return false
        }
        this.error = draftErrorCode(err)
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
          } catch (err) {
            // Same rule as resumeIfAny: a transient failure must NOT fall
            // through to creating a blank new draft (which would orphan the
            // real one and burn one of the 6 hourly creates). Keep the
            // reference and surface a retry-able error instead.
            if (!isConfirmedGone(err)) {
              this.error = draftErrorCode(err)
              return
            }
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
        this.error = draftErrorCode(err)
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
        this.error = draftErrorCode(err)
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
        this.error = draftErrorCode(err)
      } finally {
        this.sending = false
      }
    },

    /** Live config edit from a studio widget — colour, image, contact, order.
     *  Returns whether the server accepted it, so an optimistic inline edit
     *  can roll itself back instead of showing a value the server refused. */
    async patchEasy(patch: EasyPatch): Promise<boolean> {
      const ref = loadRef()
      if (!ref) return false
      this.error = ''
      try {
        this.draft = await apiFetch<WebsiteDraftView>(`/website-drafts/${ref.id}/easy`, {
          method: 'PATCH',
          headers: { 'X-Draft-Token': ref.token },
          body: { ...patch, locale: i18n.global.locale.value },
        })
        return true
      } catch (err) {
        this.error = draftErrorCode(err)
        return false
      }
    },

    /** Upload a landing / portfolio / logo image (base64 data-URI). Returns its URL. */
    async uploadAsset(
      kind: 'landing' | 'portfolio' | 'logo',
      dataUri: string,
    ): Promise<string | null> {
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
        this.error = draftErrorCode(err)
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
        this.error = draftErrorCode(err)
      } finally {
        this.sending = false
      }
    },

    /**
     * End-of-setup AI review of the owner's texts (meaning / grammar / vulgar /
     * other). Grammar fixes are applied server-side — the returned draft is
     * adopted; the remaining findings are returned for the user to address.
     */
    async reviewDraft(): Promise<DraftReviewResult> {
      const ref = loadRef()
      if (!ref) return { ok: false, code: 'no_draft' }
      try {
        const res = await apiFetch<ReviewResponse>(`/website-drafts/${ref.id}/review`, {
          method: 'POST',
          headers: { 'X-Draft-Token': ref.token },
          timeoutMs: 45_000,
        })
        if (res.draft) this.draft = res.draft
        return { ok: true, issues: Array.isArray(res.issues) ? res.issues : [] }
      } catch (err) {
        // A swallowed failure here used to render as a green "all clean" —
        // i.e. the owner could publish unchecked text believing it was
        // verified. Report the failure instead.
        return { ok: false, code: draftErrorCode(err) }
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
        this.error = draftErrorCode(err)
        return false
      }
    },

    /**
     * Abandon the current draft and start over.
     *
     * The old order (clear the local reference, THEN create) lost the draft
     * outright whenever creation failed — e.g. against the 6-per-hour create
     * throttle — leaving the previous draft an unreachable anonymous row with
     * no way back. The swap now happens ONLY after a new draft exists, so a
     * failed restart leaves the owner exactly where they were.
     */
    async restart(): Promise<boolean> {
      if (this.restarting) return false
      this.restarting = true
      this.error = ''
      try {
        const created = await apiFetch<CreateResponse>('/website-drafts', {
          method: 'POST',
          body: { locale: i18n.global.locale.value },
        })
        saveRef({ id: created.id, token: created.token })
        this.draft = created.draft
        return true
      } catch (err) {
        this.error = draftErrorCode(err)
        return false
      } finally {
        this.restarting = false
      }
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
        this.error = draftErrorCode(err)
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
