import { defineStore } from 'pinia'

import { apiFetch, ApiError } from '@/services/api'
import { i18n } from '@/plugins/i18n'
import type { WebsiteContent, WebsiteTheme } from '@/types/website'
import type {
  DraftIssue,
  EasyBlock,
  EasyPatch,
  WebsiteDraftView,
} from '@/stores/websiteDraft'

/**
 * Post-account editor for a claimed simple ("Site Simplu") site. It drives the
 * exact same widgets as the setup studio (`EasyStudioAgent`, `standalone` mode)
 * by exposing a `draft` getter shaped like `useWebsiteDraftStore().draft` — but
 * pinned to the `done` step and pointed at `/companies/:id/easy-site`.
 */
interface EasySiteResponse {
  easy: EasyBlock
  theme: WebsiteTheme
  content: WebsiteContent
  status: string
}

/** A 429 on the editor's throttled routes gets one normalized code. */
function easyErrorCode(err: unknown): string {
  if (err instanceof ApiError && err.status === 429) return 'rate_limited'
  return err instanceof Error ? err.message : 'error'
}

interface State {
  companyId: string | null
  easy: EasyBlock | null
  theme: WebsiteTheme | null
  content: WebsiteContent | null
  status: string
  loading: boolean
  sending: boolean
  error: string
}

export const useEasySiteStore = defineStore('easySite', {
  state: (): State => ({
    companyId: null,
    easy: null,
    theme: null,
    content: null,
    status: 'none',
    loading: false,
    sending: false,
    error: '',
  }),

  getters: {
    /**
     * A full `WebsiteDraftView`-shaped view so `EasyStudioAgent` consumes this
     * store unchanged. The studio only ever reads `step`, `easy`, `transcript`,
     * `theme`, `content` — the rest are inert defaults.
     */
    draft: (s): WebsiteDraftView | null =>
      s.easy
        ? {
            id: s.companyId ?? '',
            mode: 'easy',
            plan: 'easy',
            status: s.status,
            step: 'done',
            turnsUsed: 0,
            maxTurns: 0,
            turnsLeft: 0,
            capReached: false,
            complete: true,
            transcript: [],
            theme: s.theme,
            content: s.content,
            generator: null,
            ready: true,
            easy: s.easy,
            categorySlug: null,
            location: null,
            updatedAt: '',
          }
        : null,
  },

  actions: {
    adopt(res: EasySiteResponse): void {
      this.easy = res.easy
      this.theme = res.theme
      this.content = res.content
      this.status = res.status
    },

    async load(companyId: string): Promise<void> {
      this.companyId = companyId
      this.loading = true
      this.error = ''
      try {
        this.adopt(await apiFetch<EasySiteResponse>(`/companies/${companyId}/easy-site`))
      } catch (err) {
        this.error = easyErrorCode(err)
      } finally {
        this.loading = false
      }
    },

    /** Live config edit from a studio widget — colour, image, contact, order. */
    async patchEasy(patch: EasyPatch): Promise<void> {
      if (!this.companyId) return
      this.error = ''
      try {
        this.adopt(
          await apiFetch<EasySiteResponse>(`/companies/${this.companyId}/easy-site`, {
            method: 'PATCH',
            body: { ...patch, locale: i18n.global.locale.value },
          }),
        )
      } catch (err) {
        this.error = easyErrorCode(err)
      }
    },

    /** Upload a landing / portfolio / logo image (base64 data-URI). Returns its URL. */
    async uploadAsset(
      kind: 'landing' | 'portfolio' | 'logo',
      dataUri: string,
    ): Promise<string | null> {
      if (!this.companyId) return null
      this.error = ''
      try {
        const res = await apiFetch<{ id: string; url: string }>(
          `/companies/${this.companyId}/easy-site/assets`,
          { method: 'POST', body: { dataUri, kind }, timeoutMs: 30_000 },
        )
        return res.url
      } catch (err) {
        this.error = easyErrorCode(err)
        return null
      }
    },

    /** Re-run the single AI call for a new/edited list of service names. */
    async regenerateServices(names: string[]): Promise<void> {
      if (!this.companyId || this.sending) return
      this.sending = true
      this.error = ''
      try {
        this.adopt(
          await apiFetch<EasySiteResponse>(`/companies/${this.companyId}/easy-site/services`, {
            method: 'POST',
            body: { names },
            timeoutMs: 45_000,
          }),
        )
      } catch (err) {
        this.error = easyErrorCode(err)
      } finally {
        this.sending = false
      }
    },

    // --- studio-only actions with no meaning in the claimed-site editor -------
    // Kept so `EasyStudioAgent` type-checks against either store; `standalone`
    // mode never reaches the call sites (chat + guided steps are hidden).
    async advanceEasy(): Promise<void> {
      /* no guided steps in the claimed-site editor */
    },
    async send(text: string): Promise<void> {
      void text /* no chat in the claimed-site editor */
    },
    async reviewDraft(): Promise<DraftIssue[]> {
      return [] /* the end-of-setup review is a draft-only step */
    },
    async restart(): Promise<void> {
      /* nothing to restart — the site is live */
    },
  },
})
