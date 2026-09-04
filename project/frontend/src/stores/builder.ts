import { defineStore } from 'pinia'

import { apiFetch } from '@/services/api'
import type { Money } from '@/stores/wallet'
import type { WebsiteContent, WebsiteTheme } from '@/types/website'
import { STYLE_PRESETS, type PresetId } from '@/components/builder/style-presets'

// --- catalog + doc shapes (mirror backend section-catalog.ts / compose-advanced.ts) ---

export type FieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'url'
  | 'image'
  | 'boolean'
  | 'enum'
  | 'list'
  | 'items'

export interface FieldSpec {
  key: string
  type: FieldType
  label: string
  maxLength?: number
  enumValues?: string[]
  itemFields?: FieldSpec[]
  itemMax?: number
}
export interface VariantSpec {
  id: string
  label: string
}
export interface SectionSpec {
  type: string
  category: string
  label: string
  icon: string
  variants: VariantSpec[]
  fields: FieldSpec[]
}

export interface DocSection {
  id: string
  type: string
  variant: string
  visible: boolean
  /** Entrance-animation preset id; absent = inherit the theme's motion default. */
  animation?: string
  content: Record<string, unknown>
}
export interface PageSpec {
  id: string
  title: string
  slug: string
  isHome: boolean
  nav: boolean
  sections: DocSection[]
}
export interface BuilderDoc {
  v: 2
  mode: 'manual' | 'ai'
  theme: WebsiteTheme
  pages: PageSpec[]
  ai?: { brief?: string; planCount: number; sectionCount: number; notes?: string[] }
}

export interface BuilderView {
  mode: 'easy' | 'advanced'
  unlocked: boolean
  /** The post-builder location + category step is already done. */
  locationSet: boolean
  priceCredits: number
  wallet: { balance: Money }
  websiteStatus: 'draft' | 'published' | 'unpublished'
  theme: WebsiteTheme | null
  content: WebsiteContent | null
  doc: BuilderDoc | null
  aiCanUndo: boolean
  aiConfigured: boolean
  /** AI is metered per site (manual editing is unlimited). */
  aiLimits?: {
    plan: number
    section: number
    planUsed: number
    sectionUsed: number
    planLeft: number
    sectionLeft: number
  }
  catalog: SectionSpec[] | null
  /** Animation presets a section can pick (id + i18n label suffix). */
  animations?: VariantSpec[]
  /** Site-wide motion intensity options. */
  motions?: Array<'off' | 'subtle' | 'lively'>
}

export interface PageInput {
  id?: string
  title: string
  isHome: boolean
  nav: boolean
}

interface State {
  view: BuilderView | null
  activePageId: string | null
  selectedId: string | null
  catalogOpen: boolean
  loading: boolean
  working: boolean
  /** True only while a full AI site generation is in flight (drives the loader). */
  aiPlanning: boolean
  error: string
}

let patchTimer: ReturnType<typeof setTimeout> | undefined

export const useBuilderStore = defineStore('builder', {
  state: (): State => ({
    view: null,
    activePageId: null,
    selectedId: null,
    catalogOpen: false,
    loading: false,
    working: false,
    aiPlanning: false,
    error: '',
  }),

  getters: {
    unlocked: (s): boolean => s.view?.unlocked ?? false,
    doc: (s): BuilderDoc | null => s.view?.doc ?? null,
    catalog: (s): SectionSpec[] => s.view?.catalog ?? [],
    catalogByType(): Record<string, SectionSpec> {
      const map: Record<string, SectionSpec> = {}
      for (const spec of this.catalog) map[spec.type] = spec
      return map
    },
    pages: (s): PageSpec[] => s.view?.doc?.pages ?? [],
    activePage(s): PageSpec | null {
      const pages = s.view?.doc?.pages ?? []
      return pages.find((p) => p.id === s.activePageId) ?? pages[0] ?? null
    },
    selectedSection(s): DocSection | null {
      if (!s.selectedId) return null
      for (const p of s.view?.doc?.pages ?? []) {
        const found = p.sections.find((x) => x.id === s.selectedId)
        if (found) return found
      }
      return null
    },
    selectedSpec(): SectionSpec | null {
      const sec = this.selectedSection
      return sec ? (this.catalogByType[sec.type] ?? null) : null
    },
  },

  actions: {
    select(id: string | null): void {
      this.selectedId = id
    },
    setActivePage(id: string): void {
      this.activePageId = id
      this.selectedId = null
    },
    openCatalog(): void {
      this.catalogOpen = true
    },
    closeCatalog(): void {
      this.catalogOpen = false
    },

    /** Adopt a fresh server view while keeping the current selection/page focus. */
    adopt(v: BuilderView): void {
      this.view = v
      const pages = v.doc?.pages ?? []
      if (!pages.some((p) => p.id === this.activePageId)) {
        this.activePageId = (pages.find((p) => p.isHome) ?? pages[0])?.id ?? null
      }
      if (this.selectedId && !pages.some((p) => p.sections.some((x) => x.id === this.selectedId))) {
        this.selectedId = null
      }
    },

    async load(companyId: string): Promise<void> {
      this.loading = true
      this.error = ''
      try {
        this.adopt(await apiFetch<BuilderView>(`/companies/${companyId}/website-builder`))
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
      } finally {
        this.loading = false
      }
    },

    async run(fn: () => Promise<BuilderView>): Promise<boolean> {
      this.working = true
      this.error = ''
      try {
        this.adopt(await fn())
        return true
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
        return false
      } finally {
        this.working = false
      }
    },

    unlock(companyId: string): Promise<boolean> {
      return this.run(() =>
        apiFetch<BuilderView>(`/companies/${companyId}/website-builder/unlock`, { method: 'POST' }),
      )
    },

    putPages(companyId: string, pages: PageInput[]): Promise<boolean> {
      return this.run(() =>
        apiFetch<BuilderView>(`/companies/${companyId}/website-builder/pages`, {
          method: 'PUT',
          body: { pages },
        }),
      )
    },

    async addSection(
      companyId: string,
      pageId: string,
      type: string,
      variant?: string,
      index?: number,
    ): Promise<void> {
      const ok = await this.run(() =>
        apiFetch<BuilderView>(
          `/companies/${companyId}/website-builder/pages/${pageId}/sections`,
          { method: 'POST', body: { type, variant, index } },
        ),
      )
      if (ok) {
        // select the freshly-added section (last of that page, or at index)
        const page = this.pages.find((p) => p.id === pageId)
        const at = index ?? (page ? page.sections.length - 1 : -1)
        const added = page?.sections[at]
        if (added) this.selectedId = added.id
      }
    },

    moveSection(
      companyId: string,
      sectionId: string,
      toPageId: string,
      toIndex: number,
    ): Promise<boolean> {
      return this.run(() =>
        apiFetch<BuilderView>(
          `/companies/${companyId}/website-builder/sections/${sectionId}/move`,
          { method: 'POST', body: { toPageId, toIndex } },
        ),
      )
    },

    deleteSection(companyId: string, sectionId: string): Promise<boolean> {
      if (this.selectedId === sectionId) this.selectedId = null
      return this.run(() =>
        apiFetch<BuilderView>(
          `/companies/${companyId}/website-builder/sections/${sectionId}`,
          { method: 'DELETE' },
        ),
      )
    },

    patchTheme(companyId: string, patch: Partial<WebsiteTheme>): Promise<boolean> {
      return this.run(() =>
        apiFetch<BuilderView>(`/companies/${companyId}/website-builder/theme`, {
          method: 'PATCH',
          body: patch,
        }),
      )
    },

    /** Apply a one-click style bundle (writes the concrete theme fields). */
    applyPreset(companyId: string, id: PresetId): Promise<boolean> {
      return this.patchTheme(companyId, { ...STYLE_PRESETS[id], preset: id })
    },

    /**
     * Update a section. Text/content edits patch the local preview immediately
     * and debounce the network call; a `variant`/`visible` change fires at once.
     */
    patchSection(
      companyId: string,
      sectionId: string,
      patch: {
        variant?: string
        animation?: string
        visible?: boolean
        content?: Record<string, unknown>
      },
      opts: { immediate?: boolean } = {},
    ): void {
      this.applyLocal(sectionId, patch)
      const send = (): void => {
        void this.run(() =>
          apiFetch<BuilderView>(
            `/companies/${companyId}/website-builder/sections/${sectionId}`,
            { method: 'PATCH', body: patch },
          ),
        )
      }
      clearTimeout(patchTimer)
      if (
        opts.immediate ||
        patch.variant !== undefined ||
        patch.animation !== undefined ||
        patch.visible !== undefined
      ) {
        send()
      } else patchTimer = setTimeout(send, 320)
    },

    /** Optimistic local write into both the doc and the composed content. */
    applyLocal(
      sectionId: string,
      patch: {
        variant?: string
        animation?: string
        visible?: boolean
        content?: Record<string, unknown>
      },
    ): void {
      const v = this.view
      if (!v) return
      for (const p of v.doc?.pages ?? []) {
        const s = p.sections.find((x) => x.id === sectionId)
        if (s) {
          if (patch.variant !== undefined) s.variant = patch.variant
          if (patch.animation !== undefined) s.animation = patch.animation || undefined
          if (patch.visible !== undefined) s.visible = patch.visible
          if (patch.content) s.content = { ...s.content, ...patch.content }
        }
      }
      for (const p of v.content?.pages ?? []) {
        const s = p.sections.find((x) => x.id === sectionId)
        if (s) {
          if (patch.variant !== undefined) (s as Record<string, unknown>).variant = patch.variant
          if (patch.animation !== undefined) {
            ;(s as Record<string, unknown>).animation = patch.animation || undefined
          }
          if (patch.visible !== undefined) (s as Record<string, unknown>).visible = patch.visible
          if (patch.content) Object.assign(s, patch.content)
        }
      }
    },

    /** Generate the whole site from a free-text brief (AI, keeps an undo point). */
    async aiPlan(companyId: string, brief: string): Promise<boolean> {
      this.aiPlanning = true
      try {
        return await this.run(() =>
          apiFetch<BuilderView>(`/companies/${companyId}/website-builder/ai/plan`, {
            method: 'POST',
            body: { brief },
            timeoutMs: 60_000,
          }),
        )
      } finally {
        this.aiPlanning = false
      }
    },

    aiUndo(companyId: string): Promise<boolean> {
      return this.run(() =>
        apiFetch<BuilderView>(`/companies/${companyId}/website-builder/ai/undo`, { method: 'POST' }),
      )
    },

    aiSection(companyId: string, sectionId: string, instruction: string): Promise<boolean> {
      return this.run(() =>
        apiFetch<BuilderView>(
          `/companies/${companyId}/website-builder/ai/section/${sectionId}`,
          { method: 'POST', body: { instruction }, timeoutMs: 40_000 },
        ),
      )
    },

    async uploadAsset(companyId: string, kind: string, dataUri: string): Promise<string | null> {
      this.error = ''
      try {
        const res = await apiFetch<{ id: string; url: string }>(
          `/companies/${companyId}/website-builder/assets`,
          { method: 'POST', body: { dataUri, kind }, timeoutMs: 30_000 },
        )
        return res.url
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
        return null
      }
    },
  },
})
