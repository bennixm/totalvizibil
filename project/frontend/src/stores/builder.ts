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
  | 'blocks'

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
  /** Non-prose style-override targets for this type (`formInput`, `submitButton`, `itemsGap`…). */
  styleTargets: string[]
}

/** Per-section colour overrides (hex or absent = inherit the theme). */
export interface SectionStyle {
  bg?: string
  text?: string
  heading?: string
  accent?: string
}

export const EL_SIZES = ['sm', 'md', 'lg', 'xl'] as const
export const EL_WEIGHTS = ['normal', 'medium', 'semibold', 'bold'] as const
export const EL_ALIGNS = ['left', 'center', 'right'] as const
export const EL_FONTS = ['grotesk', 'inter', 'fraunces', 'jetbrains'] as const
export const EL_GAPS = ['tight', 'normal', 'relaxed', 'loose'] as const
export const EL_BORDERS = ['none', 'thin', 'medium', 'thick'] as const
export const EL_RADII = ['none', 'subtle', 'rounded', 'large', 'pill'] as const
export const EL_PADDINGS = ['sm', 'md', 'lg'] as const

/**
 * Style for one individual "part" of a section — a heading, a paragraph, a
 * form input, a button, or the gap between repeated cards/rows. Which
 * properties apply depends on the target (see `SectionSpec`'s style targets,
 * surfaced per-type from the server) — a prose field reads
 * `color/bg/size/weight/align/font`, a box-like part (button/input) reads
 * `color/bg/font/border-width/radius/padding`, a gap target reads only `gap`.
 */
export interface ElementStyle {
  color?: string
  bg?: string
  size?: (typeof EL_SIZES)[number]
  weight?: (typeof EL_WEIGHTS)[number]
  align?: (typeof EL_ALIGNS)[number]
  font?: (typeof EL_FONTS)[number]
  gap?: (typeof EL_GAPS)[number]
  borderWidth?: (typeof EL_BORDERS)[number]
  borderColor?: string
  radius?: (typeof EL_RADII)[number]
  padding?: (typeof EL_PADDINGS)[number]
}

export interface DocSection {
  id: string
  type: string
  variant: string
  visible: boolean
  /** Entrance-animation preset id; absent = inherit the theme's motion default. */
  animation?: string
  /** Colour overrides for this section. */
  style?: SectionStyle
  /** Per-element style, keyed by a style target (prose field or type-specific part). */
  overrides?: Record<string, ElementStyle>
  content: Record<string, unknown>
}
export interface PageSpec {
  id: string
  title: string
  slug: string
  isHome: boolean
  nav: boolean
  /** Reserved legal page (privacy/terms/cookies) — editable text, not removable. */
  system?: 'privacy' | 'terms' | 'cookies'
  sections: DocSection[]
}
export interface NavConfig {
  logo: 'show' | 'hide'
  sticky: boolean
  linkStyle: 'text' | 'pill'
  showPages: boolean
  cta: { label: string; target: string } | null
}
export interface FooterConfig {
  tagline: string
  showLegal: boolean
  showContact: boolean
  socials: { label: string; url: string }[]
}
export interface BuilderDoc {
  v: 2
  mode: 'manual' | 'ai'
  theme: WebsiteTheme
  pages: PageSpec[]
  nav?: NavConfig
  footer?: FooterConfig
  ai?: {
    brief?: string
    planCount: number
    sectionCount: number
    notes?: string[]
    /** Post-generation review — failed deterministic checks + the model's findings. */
    review?: {
      checks: string[]
      findings: { ref: string; severity: 'warn' | 'block'; message: string }[]
    }
  }
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
  /** Deterministic seed content per section type — lets "add section" work offline. */
  seeds?: Record<string, Record<string, unknown>>
  /** Animation presets a section can pick (id + i18n label suffix). */
  animations?: VariantSpec[]
  /** Site-wide motion intensity options. */
  motions?: Array<'off' | 'subtle' | 'lively'>
}

/** A single pre-generation clarification question. */
export interface ClarifyQuestion {
  id: string
  kind: 'choice' | 'text'
  prompt: string
  /** Only for `kind:'choice'`. Always includes an explicit "let the AI decide" option. */
  options?: { id: string; label: string }[]
}

export type ClarifyResult = { done: true } | { done: false; questions: ClarifyQuestion[] }

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
  /** Unsaved local edits — the studio no longer autosaves; the owner presses Save. */
  dirty: boolean
  /** A whole-doc save is in flight. */
  saving: boolean
  /** True only while a full AI site generation is in flight (drives the loader). */
  aiPlanning: boolean
  error: string
}

/** Max sections one page can hold (mirrors backend `MAX_SECTIONS`). */
export const MAX_SECTIONS = 10

const uuid = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })

/** Deep clone of plain JSON data. Used instead of `structuredClone`, which
 *  throws `DataCloneError` when handed a Vue reactive Proxy (e.g. store state). */
function jsonClone<T>(x: T): T {
  return x == null ? x : (JSON.parse(JSON.stringify(x)) as T)
}

function slugify(s: string): string {
  // Rough client slug for a brand-new page; the server re-slugifies on Save.
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
}

/** Rebuild the renderable `content` tree from the working `doc` (client-side
 *  mirror of the server's `composeAdvancedDoc` — enough for a faithful preview;
 *  the server re-composes + clamps on Save). */
function docToContent(doc: BuilderDoc, prev: WebsiteContent | null): WebsiteContent {
  return {
    pages: doc.pages.map((p) => ({
      slug: p.slug,
      title: p.title || p.slug,
      isHome: p.isHome,
      nav: p.system ? false : p.nav !== false,
      ...(p.system ? { system: p.system } : {}),
      sections: p.sections
        .filter((s) => s.visible !== false)
        .map((s) => ({
          id: s.id,
          type: s.type,
          visible: true,
          variant: s.variant,
          ...(s.animation ? { animation: s.animation } : {}),
          ...(s.style ? { style: s.style } : {}),
          ...(s.overrides ? { overrides: s.overrides } : {}),
          ...s.content,
        })),
    })) as unknown as WebsiteContent['pages'],
    seo: prev?.seo ?? { title: '', description: '', schemaType: 'LocalBusiness' },
    nav: doc.nav ?? prev?.nav,
    footer: doc.footer ?? prev?.footer,
  }
}

export const useBuilderStore = defineStore('builder', {
  state: (): State => ({
    view: null,
    activePageId: null,
    selectedId: null,
    catalogOpen: false,
    loading: false,
    working: false,
    dirty: false,
    saving: false,
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

    /** Snap a variant string to a valid id for the type (else the first). */
    snapVariant(type: string, variant?: string): string {
      const ids = this.catalogByType[type]?.variants.map((x) => x.id) ?? []
      return variant && ids.includes(variant) ? variant : (ids[0] ?? '')
    },

    markDirty(): void {
      this.dirty = true
    },

    /** Rebuild `view.content` from `view.doc` after a local edit. */
    recompute(): void {
      const v = this.view
      if (v?.doc) v.content = docToContent(v.doc, v.content)
    },

    /** Adopt a fresh server view; clears the dirty flag + keeps selection/page. */
    adopt(v: BuilderView): void {
      this.view = v
      this.dirty = false
      this.saving = false
      const pages = v.doc?.pages ?? []
      if (!pages.some((p) => p.id === this.activePageId)) {
        this.activePageId = (pages.find((p) => p.isHome) ?? pages[0])?.id ?? null
      }
      const chrome = this.selectedId === '__nav__' || this.selectedId === '__footer__'
      if (
        this.selectedId &&
        !chrome &&
        !pages.some((p) => p.sections.some((x) => x.id === this.selectedId))
      ) {
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

    /** Persist the whole working doc. The one and only save path. */
    async save(companyId: string): Promise<boolean> {
      if (!this.view?.doc || this.saving) return false
      this.saving = true
      this.error = ''
      try {
        const fresh = await apiFetch<BuilderView>(`/companies/${companyId}/website-builder`, {
          method: 'PUT',
          body: { doc: this.view.doc },
          timeoutMs: 30_000,
        })
        this.adopt(fresh)
        return true
      } catch (err) {
        this.error = err instanceof Error ? err.message : 'error'
        return false
      } finally {
        this.saving = false
      }
    },

    unlock(companyId: string): Promise<boolean> {
      return this.run(() =>
        apiFetch<BuilderView>(`/companies/${companyId}/website-builder/unlock`, { method: 'POST' }),
      )
    },

    // --- local editing (nothing hits the server until save()) ------------

    putPages(_companyId: string, pages: PageInput[]): void {
      const doc = this.view?.doc
      if (!doc) return
      const byId = new Map(doc.pages.map((p) => [p.id, p]))
      const systemPages = doc.pages.filter((p) => p.system)
      const real: PageSpec[] = pages
        .slice(0, 6)
        .map((p, i) => {
          const existing = p.id ? byId.get(p.id) : undefined
          if (existing?.system) return existing
          const title = (p.title || '').trim().slice(0, 60) || `Page ${i + 1}`
          return {
            id: existing?.id ?? uuid(),
            title,
            slug: existing?.slug || slugify(title) || `page-${i + 1}`,
            isHome: false,
            nav: p.nav !== false,
            sections: existing?.sections ?? [],
          }
        })
        .filter((p) => !p.system)
      if (!real.length) return
      const homeIdx = pages.findIndex((p) => p.isHome)
      real.forEach(
        (p, i) => (p.isHome = i === (homeIdx >= 0 && homeIdx < real.length ? homeIdx : 0)),
      )
      doc.pages = [...real, ...systemPages]
      if (!doc.pages.some((p) => p.id === this.activePageId)) {
        this.activePageId = (real.find((p) => p.isHome) ?? real[0])?.id ?? null
      }
      this.markDirty()
      this.recompute()
    },

    /** Returns false (and does nothing) when the page is already at MAX_SECTIONS. */
    addSection(
      _companyId: string,
      pageId: string,
      type: string,
      variant?: string,
      index?: number,
    ): boolean {
      const v = this.view
      const doc = v?.doc
      if (!doc) return false
      const page = doc.pages.find((p) => p.id === pageId)
      if (!page || page.system || page.sections.length >= MAX_SECTIONS) return false
      const section: DocSection = {
        id: uuid(),
        type,
        variant: this.snapVariant(type, variant),
        visible: true,
        content: jsonClone(v?.seeds?.[type]) ?? {},
      }
      const at = Math.min(Math.max(0, index ?? page.sections.length), page.sections.length)
      page.sections.splice(at, 0, section)
      this.selectedId = section.id
      this.markDirty()
      this.recompute()
      return true
    },

    moveSection(_companyId: string, sectionId: string, toPageId: string, toIndex: number): void {
      const doc = this.view?.doc
      if (!doc) return
      const src = doc.pages.find((p) => p.sections.some((s) => s.id === sectionId))
      const target = doc.pages.find((p) => p.id === toPageId)
      if (!src || !target || src.system || target.system) return
      const crossPage = src.id !== target.id
      // Don't overfill another page, and don't empty a page by moving its last section out.
      if (crossPage && (target.sections.length >= MAX_SECTIONS || src.sections.length <= 1)) return
      const from = src.sections.findIndex((s) => s.id === sectionId)
      const [moved] = src.sections.splice(from, 1)
      const at = Math.min(Math.max(0, toIndex), target.sections.length)
      target.sections.splice(at, 0, moved)
      this.markDirty()
      this.recompute()
    },

    /** Returns false when the section can't be removed (legal page / last on a page). */
    deleteSection(_companyId: string, sectionId: string): boolean {
      const doc = this.view?.doc
      if (!doc) return false
      const page = doc.pages.find((p) => p.sections.some((s) => s.id === sectionId))
      if (!page || page.system || page.sections.length <= 1) return false
      if (this.selectedId === sectionId) this.selectedId = null
      page.sections.splice(
        page.sections.findIndex((s) => s.id === sectionId),
        1,
      )
      this.markDirty()
      this.recompute()
      return true
    },

    patchTheme(_companyId: string, patch: Partial<WebsiteTheme>): void {
      const v = this.view
      if (!v?.doc) return
      const merged: Record<string, unknown> = { ...v.doc.theme, ...patch }
      // A granular tweak (no `preset` sent) detaches from the named bundle.
      if (!('preset' in patch)) delete merged.preset
      if ('logoUrl' in patch && !String(patch.logoUrl ?? '').trim()) delete merged.logoUrl
      v.doc.theme = merged as unknown as WebsiteTheme
      v.theme = merged as unknown as WebsiteTheme
      this.markDirty()
      this.recompute()
    },

    patchChrome(
      _companyId: string,
      patch: { nav?: Record<string, unknown>; footer?: Record<string, unknown> },
    ): void {
      const doc = this.view?.doc
      if (!doc) return
      if (patch.nav) doc.nav = { ...(doc.nav ?? {}), ...patch.nav } as NavConfig
      if (patch.footer) doc.footer = { ...(doc.footer ?? {}), ...patch.footer } as FooterConfig
      this.markDirty()
      this.recompute()
    },

    /** Apply a one-click style bundle (writes the concrete theme fields). */
    applyPreset(companyId: string, id: PresetId): void {
      this.patchTheme(companyId, { ...STYLE_PRESETS[id], preset: id })
    },

    /** Update a section (variant / animation / visibility / content / colours). */
    patchSection(
      _companyId: string,
      sectionId: string,
      patch: {
        variant?: string
        animation?: string
        visible?: boolean
        content?: Record<string, unknown>
        style?: Partial<SectionStyle>
        /** `{ [field]: ElementStyle | null }` — `null` / `{}` clears that element. */
        overrides?: Record<string, Partial<ElementStyle> | null>
      },
      _opts: { immediate?: boolean } = {},
    ): void {
      const doc = this.view?.doc
      if (!doc) return
      for (const p of doc.pages) {
        const s = p.sections.find((x) => x.id === sectionId)
        if (!s) continue
        if (patch.variant !== undefined) s.variant = this.snapVariant(s.type, patch.variant)
        if (patch.animation !== undefined) s.animation = patch.animation || undefined
        if (patch.visible !== undefined) s.visible = patch.visible
        if (patch.content) s.content = { ...s.content, ...patch.content }
        if (patch.style !== undefined) {
          const merged: Record<string, string | undefined> = { ...(s.style ?? {}), ...patch.style }
          for (const k of Object.keys(merged)) if (!merged[k]) delete merged[k]
          s.style = Object.keys(merged).length ? (merged as SectionStyle) : undefined
        }
        if (patch.overrides !== undefined) {
          const map: Record<string, ElementStyle> = { ...(s.overrides ?? {}) }
          for (const [field, el] of Object.entries(patch.overrides)) {
            if (!el || !Object.keys(el).length) {
              delete map[field]
              continue
            }
            const next: Record<string, unknown> = { ...(map[field] ?? {}), ...el }
            for (const k of Object.keys(next)) if (!next[k]) delete next[k]
            if (Object.keys(next).length) map[field] = next as ElementStyle
            else delete map[field]
          }
          s.overrides = Object.keys(map).length ? map : undefined
        }
        break
      }
      this.markDirty()
      this.recompute()
    },

    /** Generate the whole site from a free-text brief (AI, keeps an undo point).
     *  Any unsaved local edits are saved first so the planner works from them. */
    async aiPlan(
      companyId: string,
      brief: string,
      mode?: 'improve' | 'replace',
      seed?: number,
    ): Promise<boolean> {
      if (this.dirty && !(await this.save(companyId))) return false
      this.aiPlanning = true
      try {
        const body: Record<string, unknown> = { brief }
        if (mode) body.mode = mode
        if (typeof seed === 'number') body.seed = seed
        return await this.run(() =>
          apiFetch<BuilderView>(`/companies/${companyId}/website-builder/ai/plan`, {
            method: 'POST',
            body,
            timeoutMs: 120_000,
          }),
        )
      } finally {
        this.aiPlanning = false
      }
    },

    /** Start pre-generation clarification for a fresh brief — questions, or
     *  `{done:true}` when the brief already gives enough to go on. A failed
     *  call fails OPEN (treated as `done:true`) so a hiccup here never blocks
     *  generation — clarification is a quality nicety, not a hard gate. */
    async aiClarifyStart(companyId: string, brief: string): Promise<ClarifyResult> {
      this.working = true
      try {
        return await apiFetch<ClarifyResult>(
          `/companies/${companyId}/website-builder/ai/clarify`,
          { method: 'POST', body: { brief }, timeoutMs: 20_000 },
        )
      } catch {
        return { done: true }
      } finally {
        this.working = false
      }
    },

    /** Answer one round of clarification questions — the next round, or done. */
    async aiClarifyAnswer(
      companyId: string,
      answers: { questionId: string; value: string }[],
    ): Promise<ClarifyResult> {
      this.working = true
      try {
        return await apiFetch<ClarifyResult>(
          `/companies/${companyId}/website-builder/ai/clarify/answer`,
          { method: 'POST', body: { answers }, timeoutMs: 20_000 },
        )
      } catch {
        return { done: true }
      } finally {
        this.working = false
      }
    },

    aiUndo(companyId: string): Promise<boolean> {
      return this.run(() =>
        apiFetch<BuilderView>(`/companies/${companyId}/website-builder/ai/undo`, { method: 'POST' }),
      )
    },

    async aiSection(companyId: string, sectionId: string, instruction: string): Promise<boolean> {
      if (this.dirty && !(await this.save(companyId))) return false
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
