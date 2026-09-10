<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { submitLead, trackCall } from '@/services/leads'
import { pickServiceIcon } from '@/utils/serviceIcon'
import type { Section, WebsiteContent, WebsiteTheme } from '@/types/website'

const props = defineProps<{
  content: WebsiteContent
  theme: WebsiteTheme
  /** Render inside a scaled "browser frame" preview shell. */
  framed?: boolean
  /**
   * When set, the contact section becomes interactive: the form submits a lead
   * and the phone link is tracked as a "call". Absent in previews.
   */
  leadSlug?: string
  /** Advanced builder: clicking a section selects it (emits `select`). */
  editable?: boolean
  /** Advanced builder: id of the section drawn with a selection outline.
   *  `__nav__` / `__footer__` select the site chrome. */
  selectedId?: string | null
  /**
   * Advanced builder previews render one page at a time. Pass the real page
   * list so the navbar shows every page (not just the previewed one).
   */
  navPreview?: { slug: string; title: string }[]
}>()

const emit = defineEmits<{
  (e: 'lead-sent'): void
  (e: 'call'): void
  (e: 'select', id: string): void
}>()

/** Variant CSS hook, e.g. `s--hero--split`. */
function vclass(s: Section): string {
  const v = (s as { variant?: string }).variant
  return v ? `s--${s.type}--${v}` : ''
}

const { t } = useI18n()

// --- interactive contact form (only when `leadSlug` is provided) ---
const cf = reactive({ name: '', email: '', phone: '', message: '' })
const cState = ref<'idle' | 'busy' | 'sent' | 'error'>('idle')
const cError = ref('')
const cValid = computed(
  () => cf.message.trim().length > 1 && (cf.email.trim() !== '' || cf.phone.trim() !== ''),
)

async function sendContactForm(): Promise<void> {
  if (!props.leadSlug || !cValid.value || cState.value === 'busy') return
  cState.value = 'busy'
  cError.value = ''
  try {
    await submitLead(props.leadSlug, {
      name: cf.name.trim() || undefined,
      email: cf.email.trim() || undefined,
      phone: cf.phone.trim() || undefined,
      message: cf.message.trim(),
    })
    cState.value = 'sent'
    emit('lead-sent')
  } catch (err) {
    cState.value = 'error'
    cError.value = err instanceof Error ? err.message : 'error'
  }
}

function onCall(): void {
  if (props.leadSlug) trackCall(props.leadSlug)
  emit('call')
}

const PALETTE_ACCENT: Record<string, string> = {
  indigo: '#4f46e5',
  violet: '#7c3aed',
  blue: '#2563eb',
  cyan: '#0891b2',
  teal: '#0d9488',
  emerald: '#059669',
  lime: '#65a30d',
  amber: '#d97706',
  orange: '#ea580c',
  rose: '#e11d48',
  fuchsia: '#c026d3',
  slate: '#475569',
}
const RADII: Record<string, string> = {
  none: '0px',
  subtle: '6px',
  rounded: '14px',
  large: '22px',
  pill: '28px',
  // legacy aliases (old stored themes / easy builder)
  sharp: '2px',
  soft: '14px',
  round: '24px',
}
const FONT_FACES: Record<string, string> = {
  grotesk: "'Space Grotesk Variable', 'Space Grotesk', sans-serif",
  inter: "'Inter Variable', 'Inter', sans-serif",
  fraunces: "'Fraunces Variable', Georgia, 'Times New Roman', serif",
  jetbrains: "'JetBrains Mono Variable', ui-monospace, 'SFMono-Regular', monospace",
}
const FONT_PAIR: Record<string, { heading: string; body: string }> = {
  'grotesk-inter': { heading: 'grotesk', body: 'inter' },
  'serif-sans': { heading: 'fraunces', body: 'inter' },
  'mono-sans': { heading: 'jetbrains', body: 'inter' },
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

const DENSITY: Record<WebsiteTheme['density'], string> = {
  compact: '0.82',
  comfortable: '1',
  spacious: '1.25',
}
const SHADOWS: Record<string, string> = {
  none: 'none',
  soft: '0 14px 36px -18px color-mix(in srgb, var(--site-ink) 42%, transparent)',
  bold: '0 24px 54px -20px color-mix(in srgb, var(--site-ink) 60%, transparent)',
}

/** Perceptual luminance of a #rrggbb → pick black/white text on top of it. */
function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const L = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return L > 150 ? '#0b0b12' : '#ffffff'
}

const styleVars = computed(() => {
  const th = props.theme
  const accent =
    th.accent && HEX_RE.test(th.accent) ? th.accent : (PALETTE_ACCENT[th.palette] ?? PALETTE_ACCENT.indigo)
  const pair = FONT_PAIR[th.fontPair] ?? FONT_PAIR['grotesk-inter']
  const heading = FONT_FACES[th.headingFont ?? pair.heading] ?? FONT_FACES.grotesk
  const body = FONT_FACES[th.bodyFont ?? pair.body] ?? FONT_FACES.inter
  const mode = th.background ?? 'light'
  const btnPill = th.buttonStyle === 'pill'

  // background-mode base colours; every other token is color-mixed from these.
  const base =
    mode === 'dark'
      ? { bg: '#0c0d12', surf: '#16171e', ink: '#f4f5f8', bordA: 16, washA: 16 }
      : mode === 'tinted'
        ? { bg: '#ffffff', surf: '#ffffff', ink: '#0b0b12', bordA: 12, washA: 12 }
        : { bg: '#ffffff', surf: '#ffffff', ink: '#0b0b12', bordA: 12, washA: 7 }
  const bg =
    mode === 'dark'
      ? `color-mix(in srgb, ${accent} 10%, ${base.bg})`
      : mode === 'tinted'
        ? `color-mix(in srgb, ${accent} 5%, ${base.bg})`
        : base.bg

  return {
    '--site-accent': accent,
    '--site-accent-ink': inkOn(accent),
    '--site-bg': bg,
    '--site-surface':
      mode === 'dark' ? `color-mix(in srgb, ${accent} 12%, ${base.surf})` : base.surf,
    '--site-ink': `color-mix(in srgb, ${accent} ${mode === 'dark' ? 10 : 22}%, ${base.ink})`,
    '--site-ink-soft': `color-mix(in srgb, var(--site-ink) 58%, var(--site-bg))`,
    '--site-wash': `color-mix(in srgb, ${accent} ${base.washA}%, ${bg})`,
    '--site-border': `color-mix(in srgb, var(--site-ink) ${base.bordA}%, transparent)`,
    '--site-radius': RADII[th.radius] ?? RADII.rounded,
    '--site-btn-radius': btnPill ? '999px' : (RADII[th.radius] ?? RADII.rounded),
    '--site-shadow': SHADOWS[th.shadow ?? 'soft'] ?? SHADOWS.soft,
    '--site-display': heading,
    '--site-body': body,
    '--site-density': DENSITY[th.density] ?? '1',
  } as Record<string, string>
})

const pages = computed(() => props.content.pages ?? [])
/** Legal pages — linked from the footer, never the top nav. */
const legalPages = computed(() => pages.value.filter((p) => !!(p as { system?: string }).system))
/** Pages shown in the multi-page top nav. In the builder preview `navPreview`
 *  carries the real list (the preview itself renders one page at a time). */
const navPages = computed<{ slug: string; title: string }[]>(() => {
  if (props.editable && props.navPreview?.length) return props.navPreview
  return pages.value
    .filter((p) => (p as { nav?: boolean }).nav !== false && !(p as { system?: string }).system)
    .map((p) => ({ slug: p.slug, title: p.title }))
})

// --- site chrome (owner-editable navbar + footer) --------------------
const navCfg = computed(() => ({
  logo: props.content.nav?.logo ?? 'show',
  sticky: props.content.nav?.sticky !== false,
  linkStyle: props.content.nav?.linkStyle ?? 'text',
  showPages: props.content.nav?.showPages !== false,
  cta: props.content.nav?.cta ?? null,
}))
const footerCfg = computed(() => ({
  tagline: props.content.footer?.tagline ?? '',
  showLegal: props.content.footer?.showLegal !== false,
  showContact: props.content.footer?.showContact !== false,
  socials: props.content.footer?.socials ?? [],
}))
function selectChrome(id: '__nav__' | '__footer__'): void {
  if (props.editable) emit('select', id)
}
function chromeCtaGo(): void {
  goToTarget(navCfg.value.cta?.target || 'contact')
}
/**
 * Resolve a free-text link target: an external `http(s)/tel/mailto` URL opens in
 * a new tab; otherwise it's an internal page slug or a section type to jump to.
 * `javascript:` and other schemes fall through to the (harmless) section jump.
 */
function goToTarget(raw: unknown): void {
  const target = String(raw ?? '').trim()
  if (/^(https?:|tel:|mailto:)/i.test(target)) {
    window.open(target, '_blank', 'noopener,noreferrer')
    return
  }
  const pageHit = pages.value.find((p) => p.slug === target)
  if (pageHit) {
    activeSlug.value = pageHit.slug
    scrollEl.value?.scrollTo({ top: 0, behavior: 'smooth' })
  } else {
    jumpTo(target || 'contact')
  }
}
function customBlockGo(target: unknown): void {
  goToTarget(target)
}
const homeSlug = computed(
  () => (pages.value.find((p) => p.isHome) ?? pages.value[0])?.slug ?? 'home',
)
const activeSlug = ref(homeSlug.value)
watch(homeSlug, (s) => {
  if (!pages.value.some((p) => p.slug === activeSlug.value)) activeSlug.value = s
})

const page = computed(
  () => pages.value.find((p) => p.slug === activeSlug.value) ?? pages.value[0],
)
const sections = computed(() => (page.value?.sections ?? []).filter((s) => s.visible))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const f = (s: Section, key: string): any => (s as any)[key]

// --- per-section colour overrides -----------------------------------
// Emitted as one <style> block keyed by section id: setting the theme CSS
// custom properties on a section element re-tints its whole subtree.
const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const sectionStyleCss = computed(() => {
  const rules: string[] = []
  for (const p of pages.value) {
    for (const s of p.sections) {
      const st = (s as { style?: Record<string, string> }).style
      if (!st) continue
      const d: string[] = []
      if (st.bg && HEX.test(st.bg)) d.push(`--s-bg:${st.bg}`, `--site-bg:${st.bg}`)
      if (st.text && HEX.test(st.text)) d.push(`--site-ink:${st.text}`)
      if (st.heading && HEX.test(st.heading)) d.push(`--s-h:${st.heading}`)
      if (st.accent && HEX.test(st.accent)) {
        d.push(`--site-accent:${st.accent}`, `--site-accent-ink:${inkOn(st.accent)}`)
      }
      if (d.length) rules.push(`.site [id="${s.id}"]{${d.join(';')}}`)
    }
  }
  return rules.join('\n')
})

// --- per-element style overrides -----------------------------------
// Restyle one element (a heading, a paragraph) without touching the rest of
// the section. Applied as an inline :style so it always wins over the theme.
const EL_SIZE_EM: Record<string, string> = { sm: '0.85em', md: '1em', lg: '1.35em', xl: '1.8em' }
const EL_WEIGHT_N: Record<string, string> = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
}
interface ElOv {
  color?: string
  bg?: string
  size?: string
  weight?: string
  align?: string
}
function ovStyle(el?: ElOv): Record<string, string> | undefined {
  if (!el) return undefined
  const o: Record<string, string> = {}
  if (el.color && HEX.test(el.color)) o.color = el.color
  if (el.bg && HEX.test(el.bg)) {
    o.background = el.bg
    o.padding = '0.1em 0.35em'
    o.borderRadius = '0.2em'
  }
  if (el.size && EL_SIZE_EM[el.size]) o.fontSize = EL_SIZE_EM[el.size]
  if (el.weight && EL_WEIGHT_N[el.weight]) o.fontWeight = EL_WEIGHT_N[el.weight]
  if (el.align) o.textAlign = el.align
  return Object.keys(o).length ? o : undefined
}
function secOv(s: Section): Record<string, ElOv> {
  return (s as { overrides?: Record<string, ElOv> }).overrides ?? {}
}
/** Override for a section's heading element (`title` or `headline`). */
function hOv(s: Section): Record<string, string> | undefined {
  const ov = secOv(s)
  return ovStyle(ov.title ?? ov.headline)
}
/** Override for a section's lead / body element. */
function bOv(s: Section): Record<string, string> | undefined {
  const ov = secOv(s)
  return ovStyle(ov.subheadline ?? ov.body ?? ov.text ?? ov.lead ?? ov.intro)
}

/** Interactive tab index per `tabs` section (keyed by section id). */
const tabState = reactive<Record<string, number>>({})
function tabIdx(id: string): number {
  return tabState[id] ?? 0
}
function setTab(s: Section, i: number): void {
  if (props.editable) {
    emit('select', s.id)
    return
  }
  tabState[s.id] = i
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function activeTab(s: Section): any {
  const items = (f(s, 'items') || []) as unknown[]
  if (!items.length) return null
  return items[Math.min(tabIdx(s.id), items.length - 1)] ?? null
}

// --- newsletter section: a real email capture (live site only) -----
const nlState = reactive<Record<string, { email: string; state: string }>>({})
function nlEmail(id: string): string {
  return nlState[id]?.email ?? ''
}
function nlSetEmail(id: string, v: string): void {
  ;(nlState[id] ??= { email: '', state: 'idle' }).email = v
}
function nlStatus(id: string): string {
  return nlState[id]?.state ?? 'idle'
}
async function nlSubmit(s: Section): Promise<void> {
  const st = (nlState[s.id] ??= { email: '', state: 'idle' })
  const email = st.email.trim()
  if (!props.leadSlug || !/^\S+@\S+\.\S+$/.test(email) || st.state === 'busy') return
  st.state = 'busy'
  try {
    await submitLead(props.leadSlug, { email, message: 'Newsletter signup' })
    st.state = 'sent'
    emit('lead-sent')
  } catch {
    st.state = 'error'
  }
}

/** Marquee needs its items twice for a seamless CSS loop. */
function marqueeLoop(items: unknown): string[] {
  const list = (Array.isArray(items) ? items : []).map((x) => String(x)).filter(Boolean)
  return list.length ? [...list, ...list] : []
}
/** Comparison cell: ✓/✗ for yes/no/blank, otherwise the literal text. */
function cmpCell(val: unknown, isUs: boolean): string {
  const v = String(val ?? '')
    .trim()
    .toLowerCase()
  if (v === '' || v === 'yes' || v === 'da' || v === 'ja' || v === 'true') {
    return isUs ? '<span class="cmp__y">✓</span>' : '<span class="cmp__n">✗</span>'
  }
  if (v === 'no' || v === 'nu' || v === 'nein' || v === 'false' || v === '-') {
    return '<span class="cmp__n">✗</span>'
  }
  const esc = String(val ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )
  return esc
}

// --- one-page anchor navbar -------------------------------------------
const singlePage = computed(() => pages.value.length <= 1)
/**
 * Stable site identity for the nav + footer. Never the active page's title
 * (that turned the footer brand into "Contact" on the contact page). Uses the
 * SEO title, trimmed to the business name it is built from ("Name — Type, City").
 */
const brandName = computed(() => {
  const seo = (props.content.seo?.title || '').trim()
  const short = seo.split(/\s[—–|]\s|,\s/)[0].trim()
  if (short) return short
  const home = pages.value.find((p) => p.isHome) ?? pages.value[0]
  return seo || home?.title || ''
})
/** Brand logo (nav + footer). Set in either builder; blank = wordmark only. */
const logoUrl = computed(() => {
  const u = (props.theme as { logoUrl?: string }).logoUrl
  return typeof u === 'string' && u.trim() ? u.trim() : null
})
const year = new Date().getFullYear()
const NAV_TYPES = [
  'about',
  'services',
  'process',
  'features',
  'gallery',
  'testimonials',
  'faq',
  'contact',
]
const anchors = computed(() =>
  singlePage.value
    ? sections.value
        .filter((s) => NAV_TYPES.includes(s.type))
        .map((s) => ({ id: s.id, label: f(s, 'title') || s.type }))
    : [],
)

// --- footer --------------------------------------------------------
const footBlurb = computed(() => (props.content.seo?.description || '').slice(0, 160))
const footLinks = computed<{ key: string; label: string; go: () => void }[]>(() => {
  if (singlePage.value) {
    return anchors.value.map((a) => ({ key: a.id, label: a.label, go: () => navGo(a.id) }))
  }
  return navPages.value.map((p) => ({
    key: p.slug,
    label: p.title,
    go: () => {
      activeSlug.value = p.slug
      scrollEl.value?.scrollTo({ top: 0, behavior: 'smooth' })
    },
  }))
})
const footContact = computed(() => {
  for (const p of pages.value) {
    const c = (p.sections ?? []).find((s) => s.visible && s.type === 'contact')
    if (c) {
      const phone = f(c, 'phone')
      const email = f(c, 'email')
      const city = f(c, 'city')
      if (phone || email || city) return { phone, email, city }
    }
  }
  return null
})

const scrollEl = ref<HTMLElement | null>(null)
const navOpen = ref(false)

// --- editable preview (Advanced builder) ---------------------------
function onScrollClick(e: MouseEvent): void {
  if (!props.editable) return
  const el = (e.target as HTMLElement | null)?.closest('.s') as HTMLElement | null
  if (el?.id) emit('select', el.id)
}
function paintSelection(): void {
  const root = scrollEl.value
  if (!root) return
  root.querySelectorAll('.s--sel').forEach((el) => el.classList.remove('s--sel'))
  if (props.selectedId) {
    const esc =
      typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(props.selectedId) : props.selectedId
    root.querySelector(`[id="${esc}"]`)?.classList.add('s--sel')
  }
}
watch(
  () => [props.selectedId, props.editable, sections.value.map((s) => s.id).join('|')],
  () => void nextTick(paintSelection),
)

// --- scroll-progress rail on the floating navbar ----------------------
const prog = ref(0)
let progRaf = 0
function onScroll(): void {
  if (progRaf) return
  progRaf = requestAnimationFrame(() => {
    progRaf = 0
    const el = scrollEl.value
    let ratio = 0
    if (el && el.scrollHeight - el.clientHeight > 8) {
      ratio = el.scrollTop / (el.scrollHeight - el.clientHeight)
    } else if (typeof document !== 'undefined') {
      const d = document.scrollingElement ?? document.documentElement
      const max = d.scrollHeight - d.clientHeight
      ratio = max > 8 ? d.scrollTop / max : 0
    }
    prog.value = Math.min(1, Math.max(0, ratio))
  })
}

function scrollToId(id: string): void {
  const root = scrollEl.value
  if (!root) return
  const el = root.querySelector<HTMLElement>(`[id="${id}"]`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function navGo(id: string): void {
  navOpen.value = false
  scrollToId(id)
}

// --- CTA buttons: jump to a section anywhere in the site --------------
function findSection(type: string): { slug: string; id: string } | null {
  for (const p of pages.value) {
    const sec = (p.sections ?? []).find((x) => x.visible && x.type === type)
    if (sec) return { slug: p.slug, id: sec.id }
  }
  return null
}
function jumpTo(type: string): void {
  const hit = findSection(type)
  if (!hit) {
    scrollEl.value?.scrollTo({ top: scrollEl.value.scrollHeight, behavior: 'smooth' })
    return
  }
  if (hit.slug !== activeSlug.value) {
    activeSlug.value = hit.slug
    void nextTick(() => scrollToId(hit.id))
  } else {
    scrollToId(hit.id)
  }
}
function goToContact(): void {
  jumpTo('contact')
}
function goToWork(): void {
  jumpTo(findSection('gallery') ? 'gallery' : 'contact')
}
/** In the builder preview a CTA click selects its section instead of navigating. */
function ctaClick(s: Section, fn: () => void): void {
  if (props.editable) emit('select', s.id)
  else fn()
}

// --- reveal-on-scroll ----------------------------------------------------
// Decided synchronously so sections render hidden from the first paint (no
// flash of content that then hides). The observer just reveals them.
/** Site-wide motion intensity; `off` disables every entrance. */
const motion = computed<'off' | 'subtle' | 'lively'>(() => props.theme.motion ?? 'subtle')
const animate = computed(
  () =>
    motion.value !== 'off' &&
    (typeof window === 'undefined' ||
      !(
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
        typeof IntersectionObserver === 'undefined'
      )),
)
let io: IntersectionObserver | null = null

function teardownObserver(): void {
  io?.disconnect()
  io = null
}

function revealAll(): void {
  scrollEl.value
    ?.querySelectorAll<HTMLElement>('.s:not(.is-in)')
    .forEach((el) => el.classList.add('is-in'))
}

/** Mirror each section's picked animation onto its DOM node as `data-anim`. */
function paintAnims(): void {
  const root = scrollEl.value
  if (!root) return
  for (const s of sections.value) {
    const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s.id) : s.id
    const el = root.querySelector<HTMLElement>(`[id="${esc}"]`)
    if (el) el.dataset.anim = (s.animation as string) || ''
  }
}

function setupObserver(): void {
  teardownObserver()
  const root = scrollEl.value
  paintAnims()
  if (!animate.value || !root || typeof IntersectionObserver === 'undefined') {
    revealAll()
    return
  }
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in')
          io?.unobserve(e.target)
        }
      }
    },
    { root: props.framed ? root : null, rootMargin: '0px 0px -6% 0px', threshold: 0.06 },
  )
  root.querySelectorAll<HTMLElement>('.s').forEach((el) => io!.observe(el))
  // Backstop for odd layouts / observers that never fire.
  window.setTimeout(revealAll, 900)
}

onMounted(() => {
  void nextTick(setupObserver)
  scrollEl.value?.addEventListener('scroll', onScroll, { passive: true })
  if (typeof window !== 'undefined') window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})
onBeforeUnmount(() => {
  teardownObserver()
  if (progRaf) cancelAnimationFrame(progRaf)
  scrollEl.value?.removeEventListener('scroll', onScroll)
  if (typeof window !== 'undefined') window.removeEventListener('scroll', onScroll)
})

// Studio live-edits swap the section tree / change an animation — re-arm the
// observer on the new nodes so a freshly picked entrance previews once.
watch(
  () => [
    sections.value.map((s) => `${s.id}:${s.animation ?? ''}`).join('|'),
    animate.value,
  ],
  () => void nextTick(setupObserver),
)
</script>

<template>
  <div
    class="site"
    :class="[
      `site--btn-${theme.buttonStyle || 'solid'}`,
      `site--motion-${motion}`,
      { 'site--framed': framed, 'site--dark': theme.background === 'dark' },
    ]"
    :style="[styleVars, { '--site-prog': prog }]"
  >
    <component :is="'style'" v-if="sectionStyleCss">{{ sectionStyleCss }}</component>

    <div v-if="framed" class="site__chrome">
      <span /><span /><span />
      <div class="site__url">{{ content.seo.title }}</div>
    </div>

    <nav
      v-if="navPages.length > 1 || editable"
      :id="editable ? '__nav__' : undefined"
      class="site__nav"
      :class="[
        `site__nav--links-${navCfg.linkStyle}`,
        {
          'site__nav--open': navOpen,
          'site__nav--sticky': navCfg.sticky && !editable,
          'site__nav--sel': editable && selectedId === '__nav__',
          'site__nav--pick': editable,
        },
      ]"
      @click.stop="selectChrome('__nav__')"
    >
      <span v-if="navCfg.logo !== 'hide'" class="site__nav-brand">
        <img v-if="logoUrl" :src="logoUrl" :alt="brandName" class="site__logo" />
        <template v-else>{{ brandName }}</template>
      </span>
      <button
        type="button"
        class="site__nav-burger"
        :aria-expanded="navOpen"
        aria-label="Menu"
        @click.stop="navOpen = !navOpen"
      >
        <v-icon :icon="navOpen ? 'mdi-close' : 'mdi-menu'" size="20" />
      </button>
      <div class="site__nav-links">
        <template v-if="navCfg.showPages">
          <button
            v-for="p in navPages"
            :key="p.slug"
            type="button"
            :class="{ 'is-on': p.slug === activeSlug }"
            @click.stop="activeSlug = p.slug; navOpen = false"
          >
            {{ p.title }}
          </button>
        </template>
        <button
          v-if="navCfg.cta"
          type="button"
          class="site__nav-cta btn btn--solid"
          @click.stop="chromeCtaGo()"
        >
          {{ navCfg.cta.label }}
        </button>
      </div>
    </nav>

    <div
      ref="scrollEl"
      class="site__scroll"
      :class="{ 'site__scroll--anim': animate, 'site__scroll--edit': editable }"
      @click="onScrollClick"
    >
      <!-- one-page anchor navbar (real single-page sites only, not the builder preview) -->
      <header
        v-if="singlePage && !editable"
        class="site__bar"
        :class="{ 'site__bar--open': navOpen }"
      >
        <span v-if="navCfg.logo !== 'hide'" class="site__brand">
          <img v-if="logoUrl" :src="logoUrl" :alt="brandName" class="site__logo" />
          <template v-else>{{ brandName }}</template>
        </span>
        <button
          v-if="anchors.length"
          type="button"
          class="site__burger"
          :aria-expanded="navOpen"
          aria-label="Menu"
          @click="navOpen = !navOpen"
        >
          <v-icon :icon="navOpen ? 'mdi-close' : 'mdi-menu'" size="20" />
        </button>
        <nav v-if="anchors.length" class="site__links">
          <button v-for="a in anchors" :key="a.id" type="button" @click="navGo(a.id)">
            {{ a.label }}
          </button>
        </nav>
        <button
          v-if="navCfg.cta"
          type="button"
          class="site__bar-cta btn btn--solid"
          @click="chromeCtaGo()"
        >
          {{ navCfg.cta.label }}
        </button>
        <span class="site__prog" aria-hidden="true" />
      </header>

      <template v-for="s in sections" :key="s.id">
        <!-- HERO / LANDING -->
        <section
          v-if="s.type === 'hero'"
          :id="s.id"
          class="s s--hero"
          :class="[
            vclass(s),
            {
              's--hero--photo': !!f(s, 'backgroundImage'),
              's--hero--left': f(s, 'align') === 'start' || f(s, 'variant') === 'split',
            },
          ]"
          :style="
            f(s, 'backgroundImage')
              ? {
                  backgroundImage: `linear-gradient(180deg, rgba(8,10,20,0.5) 0%, rgba(8,10,20,0.42) 40%, rgba(8,10,20,0.82) 100%), url(${f(s, 'backgroundImage')})`,
                }
              : undefined
          "
        >
          <span v-if="!f(s, 'backgroundImage')" class="s--hero__aura" aria-hidden="true" />
          <div class="s--hero__in">
            <p class="s--hero__eyebrow">{{ page?.title }}</p>
            <h1 :style="hOv(s)">{{ f(s, 'headline') }}</h1>
            <p v-if="f(s, 'subheadline')" class="s--hero__sub" :style="bOv(s)">{{ f(s, 'subheadline') }}</p>
            <div class="s--hero__cta">
              <button type="button" class="btn btn--solid" @click="ctaClick(s, goToContact)">
                {{ f(s, 'primaryCta') }}
              </button>
              <button
                v-if="f(s, 'secondaryCta')"
                type="button"
                class="btn btn--ghost"
                @click="ctaClick(s, goToWork)"
              >
                {{ f(s, 'secondaryCta') }}
              </button>
            </div>
          </div>
          <span
            v-if="anchors.length"
            class="s--hero__cue"
            aria-hidden="true"
            @click="scrollToId(anchors[0].id)"
          >
            <v-icon icon="mdi-chevron-down" size="22" />
          </span>
        </section>

        <!-- ABOUT -->
        <section v-else-if="s.type === 'about'" :id="s.id" class="s s--about" :class="vclass(s)">
          <div class="s--about__in">
            <p class="s--about__eyebrow" :style="hOv(s)">{{ f(s, 'title') }}</p>
            <p class="s--about__body" :style="bOv(s)">{{ f(s, 'body') }}</p>
          </div>
          <div v-if="f(s, 'imageUrl')" class="s--about__img">
            <img :src="f(s, 'imageUrl')" alt="" loading="lazy" />
          </div>
        </section>

        <!-- STATS / NUMBERS BAND -->
        <section v-else-if="s.type === 'stats'" :id="s.id" class="s s--stats" :class="vclass(s)">
          <h2 v-if="f(s, 'title')" class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
          <div class="stats">
            <div v-for="(item, i) in f(s, 'items')" :key="i" class="stat">
              <span class="stat__v">{{ item.value }}</span>
              <span class="stat__l">{{ item.label }}</span>
            </div>
          </div>
        </section>

        <!-- PROCESS / HOW WE WORK -->
        <section v-else-if="s.type === 'process'" :id="s.id" class="s s--process">
          <h2 class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
          <ol class="proc">
            <li v-for="(item, i) in f(s, 'items')" :key="i" class="proc__step">
              <span class="proc__n">{{ String(i + 1).padStart(2, '0') }}</span>
              <div class="proc__t">
                <h3>{{ item.title }}</h3>
                <p v-if="item.text">{{ item.text }}</p>
              </div>
            </li>
          </ol>
        </section>

        <!-- SERVICES -->
        <section v-else-if="s.type === 'services'" :id="s.id" class="s s--services" :class="vclass(s)">
          <h2 class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
          <div v-if="f(s, 'layout') === 'list' || f(s, 'variant') === 'list'" class="slist">
            <div v-for="(item, i) in f(s, 'items')" :key="i" class="srow">
              <span class="srow__ic">
                <v-icon :icon="item.icon || pickServiceIcon(item.name)" size="22" />
              </span>
              <div class="srow__t">
                <h3>{{ item.name }}</h3>
                <p>{{ item.description }}</p>
              </div>
              <span class="srow__n">{{ String(i + 1).padStart(2, '0') }}</span>
            </div>
          </div>
          <div v-else class="cards">
            <article v-for="(item, i) in f(s, 'items')" :key="i" class="card">
              <span class="card__ic">
                <v-icon :icon="item.icon || pickServiceIcon(item.name)" size="22" />
              </span>
              <span class="card__n">{{ String(i + 1).padStart(2, '0') }}</span>
              <h3>{{ item.name }}</h3>
              <p>{{ item.description }}</p>
            </article>
          </div>
        </section>

        <!-- FEATURES / WHY US -->
        <section v-else-if="s.type === 'features'" :id="s.id" class="s s--feats" :class="vclass(s)">
          <h2 class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
          <div class="feats">
            <div v-for="(item, i) in f(s, 'items')" :key="i" class="feat">
              <span class="feat__ic">
                <v-icon :icon="item.icon || 'mdi-check-decagram-outline'" size="20" />
              </span>
              <div>
                <strong>{{ item.title }}</strong>
                <p v-if="item.text">{{ item.text }}</p>
              </div>
            </div>
          </div>
        </section>

        <!-- GALLERY / PORTFOLIO -->
        <section v-else-if="s.type === 'gallery'" :id="s.id" class="s s--gallery" :class="vclass(s)">
          <h2 class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
          <div class="pfolio">
            <figure v-for="(item, i) in f(s, 'items')" :key="i" class="pcard">
              <img v-if="item.imageUrl" :src="item.imageUrl" :alt="item.title || ''" loading="lazy" />
              <span v-else class="pcard__ph" aria-hidden="true" />
              <figcaption v-if="item.description || item.title">
                {{ item.description || item.title }}
              </figcaption>
            </figure>
          </div>
        </section>

        <!-- TESTIMONIALS -->
        <section v-else-if="s.type === 'testimonials'" :id="s.id" class="s s--quotes" :class="vclass(s)">
          <h2 class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
          <div class="quotes">
            <figure v-for="(item, i) in f(s, 'items')" :key="i" class="quote">
              <span class="quote__mark" aria-hidden="true">”</span>
              <blockquote>{{ item.quote }}</blockquote>
              <figcaption v-if="item.author">
                <span class="quote__av">{{ (item.author || '?').charAt(0).toUpperCase() }}</span>
                {{ item.author }}
              </figcaption>
            </figure>
          </div>
        </section>

        <!-- FAQ -->
        <section v-else-if="s.type === 'faq'" :id="s.id" class="s s--faq" :class="vclass(s)">
          <h2 class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
          <details v-for="(item, i) in f(s, 'items')" :key="i" class="qa">
            <summary>
              <span>{{ item.q }}</span>
              <v-icon icon="mdi-plus" size="18" class="qa__pl" />
            </summary>
            <p>{{ item.a }}</p>
          </details>
        </section>

        <!-- CONTACT -->
        <section v-else-if="s.type === 'contact'" :id="s.id" class="s s--contact">
          <h2 class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>

          <div class="ccards">
            <a
              v-if="f(s, 'phone')"
              class="ccard"
              :href="leadSlug ? `tel:${f(s, 'phone')}` : undefined"
              @click="leadSlug && onCall()"
            >
              <span class="ccard__ic"><v-icon icon="mdi-phone" size="20" /></span>
              <span class="ccard__k">{{ t('site.phone') }}</span>
              <span class="ccard__v">{{ f(s, 'phone') }}</span>
            </a>
            <a
              v-if="f(s, 'email')"
              class="ccard"
              :href="leadSlug ? `mailto:${f(s, 'email')}` : undefined"
            >
              <span class="ccard__ic"><v-icon icon="mdi-email-outline" size="20" /></span>
              <span class="ccard__k">{{ t('site.email') }}</span>
              <span class="ccard__v">{{ f(s, 'email') }}</span>
            </a>
            <div v-if="f(s, 'city')" class="ccard">
              <span class="ccard__ic"><v-icon icon="mdi-map-marker-outline" size="20" /></span>
              <span class="ccard__k">{{ t('site.area') }}</span>
              <span class="ccard__v">{{ f(s, 'city') }}</span>
            </div>
            <div v-if="f(s, 'hours')" class="ccard">
              <span class="ccard__ic"><v-icon icon="mdi-clock-outline" size="20" /></span>
              <span class="ccard__k">{{ t('site.hours') }}</span>
              <span class="ccard__v">{{ f(s, 'hours') }}</span>
            </div>
          </div>

          <!-- Request form. Interactive on the live site; an inert preview in
               the builder / before the site is claimed. -->
          <form
            v-if="cState !== 'sent'"
            class="cform"
            :class="{ 'cform--preview': !leadSlug }"
            @submit.prevent="leadSlug && sendContactForm()"
          >
            <p class="cform__lead">{{ t('site.formLead') }}</p>
            <div class="cform__row">
              <input v-model="cf.name" type="text" :placeholder="t('site.fName')" autocomplete="name" :disabled="!leadSlug" />
              <input v-model="cf.email" type="email" :placeholder="t('site.fEmail')" autocomplete="email" :disabled="!leadSlug" />
            </div>
            <input v-model="cf.phone" type="tel" :placeholder="t('site.fPhone')" autocomplete="tel" :disabled="!leadSlug" />
            <textarea v-model="cf.message" rows="3" :placeholder="t('site.fMessage')" :required="!!leadSlug" :disabled="!leadSlug"></textarea>
            <p v-if="cState === 'error'" class="cform__err">{{ t('site.formError') }}</p>
            <button type="submit" class="btn btn--solid" :disabled="!leadSlug || !cValid || cState === 'busy'">
              {{ cState === 'busy' ? t('site.formSending') : t('site.formSend') }}
            </button>
            <p v-if="!leadSlug" class="cform__note">{{ t('site.formPreview') }}</p>
          </form>
          <p v-else class="cform__ok">
            <span aria-hidden="true">✓</span> {{ t('site.formThanks') }}
          </p>
        </section>

        <!-- LOGOS -->
        <section v-else-if="s.type === 'logos'" :id="s.id" class="s s--logos" :class="vclass(s)">
          <p v-if="f(s, 'title')" class="s--logos__t">{{ f(s, 'title') }}</p>
          <div class="logos">
            <span v-for="(item, i) in f(s, 'items')" :key="i" class="logo">
              <img v-if="item.imageUrl" :src="item.imageUrl" :alt="item.name || ''" loading="lazy" />
              <span v-else>{{ item.name }}</span>
            </span>
          </div>
        </section>

        <!-- FEATURE SPLIT -->
        <section
          v-else-if="s.type === 'featureSplit'"
          :id="s.id"
          class="s s--fsplit"
          :class="vclass(s)"
        >
          <h2 v-if="f(s, 'title')" class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
          <div
            v-for="(item, i) in f(s, 'items')"
            :key="i"
            class="fsrow"
            :class="{ 'fsrow--rev': item.mediaSide === 'left' }"
          >
            <div class="fsrow__media">
              <img v-if="item.imageUrl" :src="item.imageUrl" :alt="item.title || ''" loading="lazy" />
              <span v-else class="fsrow__ph" aria-hidden="true" />
            </div>
            <div class="fsrow__txt">
              <h3>{{ item.title }}</h3>
              <p v-if="item.text">{{ item.text }}</p>
            </div>
          </div>
        </section>

        <!-- TEAM -->
        <section v-else-if="s.type === 'team'" :id="s.id" class="s s--team" :class="vclass(s)">
          <h2 class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
          <div class="team">
            <figure v-for="(m, i) in f(s, 'items')" :key="i" class="tm">
              <span class="tm__ph">
                <img v-if="m.imageUrl" :src="m.imageUrl" :alt="m.name || ''" loading="lazy" />
                <span v-else>{{ (m.name || '?').charAt(0).toUpperCase() }}</span>
              </span>
              <figcaption>
                <strong>{{ m.name }}</strong>
                <span v-if="m.role" class="tm__role">{{ m.role }}</span>
                <span v-if="m.bio" class="tm__bio">{{ m.bio }}</span>
              </figcaption>
            </figure>
          </div>
        </section>

        <!-- PRICING -->
        <section v-else-if="s.type === 'pricing'" :id="s.id" class="s s--pricing" :class="vclass(s)">
          <h2 class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
          <div class="price">
            <article
              v-for="(p, i) in f(s, 'items')"
              :key="i"
              class="tier"
              :class="{ 'tier--hi': p.highlighted }"
            >
              <strong class="tier__name">{{ p.name }}</strong>
              <span class="tier__price">{{ p.price }}<em v-if="p.period">{{ p.period }}</em></span>
              <ul class="tier__feats">
                <li v-for="(ft, j) in p.features" :key="j">
                  <v-icon icon="mdi-check" size="15" /> {{ ft }}
                </li>
              </ul>
              <button
                v-if="p.cta"
                type="button"
                class="btn btn--solid tier__cta"
                @click="ctaClick(s, goToContact)"
              >
                {{ p.cta }}
              </button>
            </article>
          </div>
        </section>

        <!-- RICH TEXT -->
        <section v-else-if="s.type === 'richText'" :id="s.id" class="s s--rich" :class="vclass(s)">
          <h2 v-if="f(s, 'title')" class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
          <div class="rich">
            <p v-for="(para, i) in String(f(s, 'body') || '').split(/\n{2,}/)" :key="i">{{ para }}</p>
          </div>
        </section>

        <!-- CTA -->
        <section v-else-if="s.type === 'cta'" :id="s.id" class="s s--cta" :class="vclass(s)">
          <span class="s--cta__glow" aria-hidden="true" />
          <h2 class="s__h" :style="hOv(s)">{{ f(s, 'headline') }}</h2>
          <button type="button" class="btn btn--solid s--cta__btn" @click="ctaClick(s, goToContact)">
            {{ f(s, 'buttonLabel') }}
          </button>
        </section>

        <!-- MARQUEE / scrolling strip -->
        <section
          v-else-if="s.type === 'marquee'"
          :id="s.id"
          class="s s--mrq"
          :class="[vclass(s), `s--mrq--${f(s, 'speed') || 'normal'}`]"
        >
          <h2 v-if="f(s, 'title')" class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
          <div class="mrq" :class="{ 'mrq--static': editable }">
            <div class="mrq__track">
              <span v-for="(it, i) in marqueeLoop(f(s, 'items'))" :key="i" class="mrq__i">
                {{ it }}
              </span>
            </div>
          </div>
        </section>

        <!-- BENTO grid -->
        <section v-else-if="s.type === 'bento'" :id="s.id" class="s s--bento" :class="vclass(s)">
          <h2 v-if="f(s, 'title')" class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
          <div class="bento">
            <article v-for="(it, i) in f(s, 'items')" :key="i" class="bento__c">
              <div
                v-if="it.imageUrl"
                class="bento__img"
                :style="{ backgroundImage: `url(${it.imageUrl})` }"
              />
              <div class="bento__t">
                <h3>{{ it.title }}</h3>
                <p v-if="it.text">{{ it.text }}</p>
              </div>
            </article>
          </div>
        </section>

        <!-- TIMELINE -->
        <section v-else-if="s.type === 'timeline'" :id="s.id" class="s s--tl" :class="vclass(s)">
          <h2 v-if="f(s, 'title')" class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
          <ol class="tl">
            <li v-for="(it, i) in f(s, 'items')" :key="i" class="tl__i">
              <span class="tl__dot" aria-hidden="true" />
              <span class="tl__date">{{ it.date }}</span>
              <div class="tl__t">
                <h3>{{ it.title }}</h3>
                <p v-if="it.text">{{ it.text }}</p>
              </div>
            </li>
          </ol>
        </section>

        <!-- COMPARISON -->
        <section v-else-if="s.type === 'comparison'" :id="s.id" class="s s--cmp" :class="vclass(s)">
          <table class="cmp">
            <thead>
              <tr>
                <th />
                <th class="cmp__us">{{ f(s, 'usTitle') }}</th>
                <th>{{ f(s, 'themTitle') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(it, i) in f(s, 'items')" :key="i">
                <td class="cmp__lbl">{{ it.label }}</td>
                <td class="cmp__us" v-html="cmpCell(it.us, true)" />
                <td v-html="cmpCell(it.them, false)" />
              </tr>
            </tbody>
          </table>
        </section>

        <!-- BANNER strip -->
        <section v-else-if="s.type === 'banner'" :id="s.id" class="s s--banner" :class="vclass(s)">
          <div class="banner">
            <p>{{ f(s, 'text') }}</p>
            <button
              v-if="f(s, 'buttonLabel')"
              type="button"
              class="btn btn--solid"
              @click="ctaClick(s, goToContact)"
            >
              {{ f(s, 'buttonLabel') }}
            </button>
          </div>
        </section>

        <!-- CUSTOM — owner-assembled block stack -->
        <section
          v-else-if="s.type === 'custom'"
          :id="s.id"
          class="s s--custom"
          :class="[
            vclass(s),
            `s--custom--w-${f(s, 'width') || 'standard'}`,
            `s--custom--bg-${f(s, 'background') || 'transparent'}`,
            { 's--custom--center': f(s, 'align') === 'center' },
          ]"
        >
          <div class="s--custom__in">
            <template v-for="(b, bi) in (Array.isArray(f(s, 'blocks')) ? f(s, 'blocks') : [])" :key="bi">
              <component
                :is="b.size === 'md' ? 'h3' : b.size === 'sm' ? 'h4' : 'h2'"
                v-if="b.kind === 'heading' && b.text"
                class="s--custom__h"
                :class="`s--custom__h--${b.size || 'lg'}`"
                :style="b.color ? { color: b.color } : undefined"
              >
                {{ b.text }}
              </component>
              <div
                v-else-if="b.kind === 'text' && b.text"
                class="s--custom__tx"
                :style="b.color ? { color: b.color } : undefined"
              >
                <p v-for="(para, pj) in String(b.text).split(/\n{2,}/)" :key="pj">{{ para }}</p>
              </div>
              <figure v-else-if="b.kind === 'image' && b.url" class="s--custom__fig">
                <img :src="b.url" :alt="b.caption || ''" loading="lazy" />
                <figcaption v-if="b.caption">{{ b.caption }}</figcaption>
              </figure>
              <div v-else-if="b.kind === 'button' && b.label" class="s--custom__btnw">
                <button
                  type="button"
                  class="btn"
                  :class="b.variant === 'ghost' ? 'btn--ghost' : 'btn--solid'"
                  @click="ctaClick(s, () => customBlockGo(b.target))"
                >
                  {{ b.label }}
                </button>
              </div>
              <div
                v-else-if="b.kind === 'spacer'"
                class="s--custom__sp"
                :class="`s--custom__sp--${b.size || 'md'}`"
                aria-hidden="true"
              />
              <hr v-else-if="b.kind === 'divider'" class="s--custom__hr" />
            </template>
          </div>
        </section>

        <!-- BIG STATEMENT -->
        <section
          v-else-if="s.type === 'bigStatement'"
          :id="s.id"
          class="s s--bigStatement"
          :class="vclass(s)"
        >
          <div class="stmt">
            <p class="stmt__t">{{ f(s, 'statement') }}</p>
            <ul v-if="(f(s, 'items') || []).length" class="stmt__l">
              <li v-for="(it, i) in f(s, 'items')" :key="i">{{ it }}</li>
            </ul>
          </div>
        </section>

        <!-- HIGHLIGHTS ROW -->
        <section
          v-else-if="s.type === 'highlightsRow'"
          :id="s.id"
          class="s s--highlightsRow"
          :class="vclass(s)"
        >
          <h2 v-if="f(s, 'title')" class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
          <div class="hl">
            <div v-for="(it, i) in f(s, 'items')" :key="i" class="hl__i">
              <v-icon :icon="it.icon || 'mdi-check-circle-outline'" size="24" />
              <span>{{ it.label }}</span>
            </div>
          </div>
        </section>

        <!-- RATING BAND -->
        <section
          v-else-if="s.type === 'ratingBand'"
          :id="s.id"
          class="s s--ratingBand"
          :class="vclass(s)"
        >
          <div class="rate">
            <div class="rate__score">
              <span class="rate__n">{{ f(s, 'rating') }}</span>
              <span class="rate__stars" aria-hidden="true">★★★★★</span>
              <span class="rate__meta">
                {{ f(s, 'count') }}<template v-if="f(s, 'source')"> · {{ f(s, 'source') }}</template>
              </span>
            </div>
            <p v-if="f(s, 'text')" class="rate__t">{{ f(s, 'text') }}</p>
          </div>
        </section>

        <!-- VIDEO -->
        <section v-else-if="s.type === 'video'" :id="s.id" class="s s--video" :class="vclass(s)">
          <h2 v-if="f(s, 'title')" class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
          <div
            class="vid"
            :class="{ 'vid--photo': !!f(s, 'posterImage'), 'vid--live': !!f(s, 'videoUrl') || editable }"
            :style="
              f(s, 'posterImage')
                ? {
                    backgroundImage: `linear-gradient(rgba(8,10,20,0.3), rgba(8,10,20,0.5)), url(${f(s, 'posterImage')})`,
                  }
                : undefined
            "
            @click="
              editable
                ? emit('select', s.id)
                : f(s, 'videoUrl') && customBlockGo(f(s, 'videoUrl'))
            "
          >
            <span v-if="f(s, 'videoUrl') || editable" class="vid__play" aria-hidden="true">
              <v-icon icon="mdi-play" size="32" />
            </span>
          </div>
          <p v-if="f(s, 'caption')" class="vid__cap">{{ f(s, 'caption') }}</p>
        </section>

        <!-- SHOWCASE (full-bleed image + overlay) -->
        <section
          v-else-if="s.type === 'showcase'"
          :id="s.id"
          class="s s--showcase"
          :class="[
            vclass(s),
            { 's--showcase--photo': !!f(s, 'backgroundImage'), 's--showcase--center': f(s, 'variant') === 'center' },
          ]"
          :style="
            f(s, 'backgroundImage')
              ? {
                  backgroundImage: `linear-gradient(180deg, rgba(8,10,20,0.45), rgba(8,10,20,0.75)), url(${f(s, 'backgroundImage')})`,
                }
              : undefined
          "
        >
          <div class="show__in">
            <h2>{{ f(s, 'headline') }}</h2>
            <p v-if="f(s, 'text')">{{ f(s, 'text') }}</p>
            <button
              v-if="f(s, 'buttonLabel')"
              type="button"
              class="btn btn--solid"
              @click="ctaClick(s, goToContact)"
            >
              {{ f(s, 'buttonLabel') }}
            </button>
          </div>
        </section>

        <!-- BEFORE / AFTER -->
        <section
          v-else-if="s.type === 'beforeAfter'"
          :id="s.id"
          class="s s--beforeAfter"
          :class="vclass(s)"
        >
          <h2 v-if="f(s, 'title')" class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
          <div class="ba">
            <figure class="ba__c">
              <img v-if="f(s, 'beforeImage')" :src="f(s, 'beforeImage')" alt="" loading="lazy" />
              <span v-else class="ba__ph" aria-hidden="true" />
              <figcaption>{{ f(s, 'beforeLabel') || 'Before' }}</figcaption>
            </figure>
            <figure class="ba__c ba__c--after">
              <img v-if="f(s, 'afterImage')" :src="f(s, 'afterImage')" alt="" loading="lazy" />
              <span v-else class="ba__ph" aria-hidden="true" />
              <figcaption>{{ f(s, 'afterLabel') || 'After' }}</figcaption>
            </figure>
          </div>
        </section>

        <!-- TABS -->
        <section v-else-if="s.type === 'tabs'" :id="s.id" class="s s--tabs" :class="vclass(s)">
          <h2 v-if="f(s, 'title')" class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
          <div class="tabx">
            <div class="tabx__bar" role="tablist">
              <button
                v-for="(it, i) in f(s, 'items')"
                :key="i"
                type="button"
                class="tabx__b"
                :class="{ 'is-on': Math.min(tabIdx(s.id), (f(s, 'items') || []).length - 1) === i }"
                @click.stop="setTab(s, i)"
              >
                {{ it.label || `Tab ${i + 1}` }}
              </button>
            </div>
            <div v-if="activeTab(s)" class="tabx__panel">
              <div class="tabx__txt">
                <p
                  v-for="(para, pj) in String(activeTab(s).body || '').split(/\n{2,}/)"
                  :key="pj"
                >
                  {{ para }}
                </p>
              </div>
              <img
                v-if="activeTab(s).imageUrl"
                :src="activeTab(s).imageUrl"
                alt=""
                loading="lazy"
                class="tabx__img"
              />
            </div>
          </div>
        </section>

        <!-- OPENING HOURS -->
        <section v-else-if="s.type === 'hours'" :id="s.id" class="s s--hours" :class="vclass(s)">
          <h2 v-if="f(s, 'title')" class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
          <table class="hrs">
            <tbody>
              <tr v-for="(it, i) in f(s, 'items')" :key="i">
                <th>{{ it.day }}</th>
                <td>{{ it.value }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="f(s, 'note')" class="hrs__note">{{ f(s, 'note') }}</p>
        </section>

        <!-- CASE STUDY -->
        <section
          v-else-if="s.type === 'caseStudy'"
          :id="s.id"
          class="s s--caseStudy"
          :class="[vclass(s), { 's--caseStudy--rev': f(s, 'variant') === 'imageRight' }]"
        >
          <div class="cse__media">
            <img v-if="f(s, 'imageUrl')" :src="f(s, 'imageUrl')" alt="" loading="lazy" />
            <span v-else class="cse__ph" aria-hidden="true" />
            <div v-if="f(s, 'metric')" class="cse__metric">
              <strong>{{ f(s, 'metric') }}</strong>
              <span v-if="f(s, 'metricLabel')">{{ f(s, 'metricLabel') }}</span>
            </div>
          </div>
          <div class="cse__body">
            <p v-if="f(s, 'client')" class="cse__client">{{ f(s, 'client') }}</p>
            <h2 v-if="f(s, 'title')" class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
            <div v-if="f(s, 'challenge')" class="cse__row"><span>01</span><p>{{ f(s, 'challenge') }}</p></div>
            <div v-if="f(s, 'solution')" class="cse__row"><span>02</span><p>{{ f(s, 'solution') }}</p></div>
            <div v-if="f(s, 'result')" class="cse__row"><span>03</span><p>{{ f(s, 'result') }}</p></div>
          </div>
        </section>

        <!-- SPLIT CTA -->
        <section
          v-else-if="s.type === 'splitCta'"
          :id="s.id"
          class="s s--splitCta"
          :class="vclass(s)"
        >
          <h2 v-if="f(s, 'title')" class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
          <div class="scta">
            <article v-for="(it, i) in f(s, 'items')" :key="i" class="scta__c">
              <h3>{{ it.title }}</h3>
              <p v-if="it.text">{{ it.text }}</p>
              <button
                v-if="it.buttonLabel"
                type="button"
                class="btn btn--solid"
                @click="ctaClick(s, () => customBlockGo(it.target || 'contact'))"
              >
                {{ it.buttonLabel }}
              </button>
            </article>
          </div>
        </section>

        <!-- NEWSLETTER -->
        <section
          v-else-if="s.type === 'newsletter'"
          :id="s.id"
          class="s s--newsletter"
          :class="vclass(s)"
        >
          <div class="news">
            <h2 v-if="f(s, 'title')" class="s__h" :style="hOv(s)">{{ f(s, 'title') }}</h2>
            <p v-if="f(s, 'text')" class="news__t">{{ f(s, 'text') }}</p>
            <form
              v-if="nlStatus(s.id) !== 'sent'"
              class="news__form"
              :class="{ 'news__form--preview': !leadSlug }"
              @submit.prevent="nlSubmit(s)"
            >
              <input
                type="email"
                :value="nlEmail(s.id)"
                :placeholder="f(s, 'placeholder') || 'you@email.com'"
                :disabled="!leadSlug || nlStatus(s.id) === 'busy'"
                @input="nlSetEmail(s.id, ($event.target as HTMLInputElement).value)"
              />
              <button
                type="submit"
                class="btn btn--solid"
                :disabled="!leadSlug || nlStatus(s.id) === 'busy'"
              >
                {{ f(s, 'buttonLabel') || t('site.formSend') }}
              </button>
            </form>
            <p v-else class="news__ok"><span aria-hidden="true">✓</span> {{ t('site.formThanks') }}</p>
            <p v-if="nlStatus(s.id) === 'error'" class="news__err">{{ t('site.formError') }}</p>
            <p v-if="!leadSlug" class="news__n">{{ t('site.formPreview') }}</p>
            <p v-else-if="f(s, 'note')" class="news__n">{{ f(s, 'note') }}</p>
          </div>
        </section>

        <!-- BIG QUOTE -->
        <section v-else-if="s.type === 'quoteBig'" :id="s.id" class="s s--quoteBig" :class="vclass(s)">
          <figure class="qb">
            <span class="qb__mark" aria-hidden="true">”</span>
            <blockquote>{{ f(s, 'quote') }}</blockquote>
            <figcaption v-if="f(s, 'author') || f(s, 'imageUrl')">
              <img v-if="f(s, 'imageUrl')" :src="f(s, 'imageUrl')" alt="" loading="lazy" class="qb__av" />
              <span>
                <strong>{{ f(s, 'author') }}</strong>
                <em v-if="f(s, 'role')">{{ f(s, 'role') }}</em>
              </span>
            </figcaption>
          </figure>
        </section>
      </template>

      <footer
        :id="editable ? '__footer__' : undefined"
        class="site__foot"
        :class="{ 'site__foot--sel': editable && selectedId === '__footer__', 'site__foot--pick': editable }"
        @click.stop="selectChrome('__footer__')"
      >
        <div class="site__foot-in">
          <div class="site__foot-col site__foot-col--brand">
            <span class="site__foot-brand">
              <img v-if="logoUrl" :src="logoUrl" :alt="brandName" class="site__logo site__logo--foot" />
              <template v-else>{{ brandName }}</template>
            </span>
            <p v-if="footerCfg.tagline || footBlurb" class="site__foot-blurb">
              {{ footerCfg.tagline || footBlurb }}
            </p>
            <div v-if="footerCfg.socials.length" class="site__foot-social">
              <a
                v-for="soc in footerCfg.socials"
                :key="soc.url"
                :href="soc.url"
                target="_blank"
                rel="noopener nofollow"
                @click.stop
              >
                {{ soc.label }}
              </a>
            </div>
          </div>
          <nav v-if="footLinks.length" class="site__foot-col">
            <span class="site__foot-h">{{ t('site.footExplore') }}</span>
            <button
              v-for="l in footLinks"
              :key="l.key"
              type="button"
              @click.stop="l.go()"
            >
              {{ l.label }}
            </button>
          </nav>
          <div v-if="footerCfg.showContact && footContact" class="site__foot-col">
            <span class="site__foot-h">{{ t('site.footContact') }}</span>
            <span v-if="footContact.phone">{{ footContact.phone }}</span>
            <span v-if="footContact.email">{{ footContact.email }}</span>
            <span v-if="footContact.city">{{ footContact.city }}</span>
          </div>
          <nav v-if="footerCfg.showLegal && legalPages.length" class="site__foot-col">
            <span class="site__foot-h">{{ t('site.footLegal') }}</span>
            <button
              v-for="p in legalPages"
              :key="p.slug"
              type="button"
              @click.stop="activeSlug = p.slug; scrollEl?.scrollTo({ top: 0 })"
            >
              {{ p.title }}
            </button>
          </nav>
        </div>
        <div class="site__foot-bar">
          <span>© {{ year }} {{ brandName }}</span>
          <span class="site__foot-made">{{ t('site.madeWith') }}</span>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.site {
  --pad: clamp(1.6rem, 5.5vw, 4.5rem);
  container-type: inline-size;
  font-family: var(--site-body);
  color: var(--site-ink);
  background: var(--site-bg);
  border-radius: var(--tvz-radius-lg);
  border: 1px solid var(--tvz-hairline);
  -webkit-font-smoothing: antialiased;
}
/* Framed preview clips to the rounded shell; the public render stays open so
   the sticky one-page navbar can pin to the viewport. */
.site--framed {
  overflow: hidden;
  box-shadow: var(--tvz-shadow-lg);
}
.site__chrome {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.6rem 0.9rem;
  background: #f4f4f6;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}
.site__chrome span {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #cfcfd6;
}
.site__url {
  margin-left: 0.6rem;
  font-size: 11px;
  color: #6b7280;
  font-family: var(--tvz-mono, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* multi-page top nav (advanced sites) */
.site__nav {
  position: relative;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem clamp(1rem, 4vw, 2.4rem);
  background: color-mix(in srgb, var(--site-bg) 82%, transparent);
  backdrop-filter: blur(14px) saturate(1.3);
  border-bottom: 1px solid var(--site-border);
}
.site__nav--sticky {
  position: sticky;
}
.site__nav--pick {
  cursor: pointer;
  outline-offset: -2px;
  transition: outline-color 0.12s ease;
  outline: 2px solid transparent;
}
.site__nav--pick:hover {
  outline-color: color-mix(in srgb, var(--site-accent) 55%, transparent);
}
.site__nav--sel {
  outline-color: var(--site-accent) !important;
}
/* Brand logo image (any brand slot). Height-capped, width auto — keeps a
   wordmark or an icon-mark legible without dominating the bar. */
.site__logo {
  display: block;
  height: 30px;
  width: auto;
  max-width: 190px;
  object-fit: contain;
}
.site__logo--foot {
  height: 34px;
  max-width: 220px;
}
.site__nav-brand {
  display: inline-flex;
  align-items: center;
  margin-right: auto;
  font-family: var(--site-display);
  font-weight: 700;
  font-size: 1rem;
  color: var(--site-ink);
  min-width: 0;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.site__nav-burger {
  display: none;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 9px;
  color: var(--site-ink);
  background: color-mix(in srgb, var(--site-ink) 6%, transparent);
}
.site__nav-links {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.site__nav--links-pill .site__nav-links button {
  background: color-mix(in srgb, var(--site-ink) 5%, transparent);
}
.site__nav-cta {
  margin-left: 0.4rem;
  padding: 0.4rem 0.95rem !important;
  font-size: 0.82rem !important;
}
.site__nav-links button {
  flex: 0 0 auto;
  padding: 0.45rem 0.9rem;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--site-ink-soft);
  font-family: var(--site-body);
  transition:
    color 0.14s ease,
    background 0.14s ease;
}
.site__nav-links button:hover {
  color: var(--site-ink);
  background: color-mix(in srgb, var(--site-ink) 6%, transparent);
}
.site__nav-links button.is-on {
  background: var(--site-accent);
  color: var(--site-accent-ink);
}

/* collapse to a burger inside a narrow site container */
@container (max-width: 600px) {
  .site__nav {
    flex-wrap: wrap;
  }
  .site__nav-brand {
    display: inline-flex;
    flex: 1;
    order: 1;
  }
  .site__nav-burger {
    display: grid;
    order: 2;
  }
  .site__nav-links {
    order: 3;
    flex-basis: 100%;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    gap: 0;
    overflow: hidden;
    max-height: 0;
    transition: max-height 0.28s ease;
  }
  .site__nav-cta {
    margin: 0.4rem 0 0;
  }
  .site__nav--open .site__nav-links {
    max-height: 70vh;
    overflow-y: auto;
    margin-top: 0.5rem;
  }
  .site__nav-links button {
    width: 100%;
    text-align: left;
    border-radius: 8px;
    padding: 0.75rem 0.7rem;
    font-size: 0.95rem;
  }
  .site__nav-links button + button {
    border-top: 1px solid var(--site-border);
  }
}

.site__scroll {
  overflow-y: auto;
  scroll-behavior: smooth;
  counter-reset: sec;
  background: var(--site-bg);
}
.site--framed .site__scroll {
  max-height: 620px;
}

/* one-page anchor navbar — a floating pill */
.site__bar {
  position: sticky;
  top: 0.6rem;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin: 0.6rem clamp(0.6rem, 4vw, 1.4rem) 0;
  padding: 0.6rem 0.7rem 0.6rem clamp(1rem, 4vw, 1.6rem);
  background: color-mix(in srgb, var(--site-bg) 76%, transparent);
  backdrop-filter: blur(16px) saturate(1.4);
  border: 1px solid var(--site-border);
  border-radius: 999px;
  box-shadow: 0 16px 38px -22px color-mix(in srgb, var(--site-ink) 55%, transparent);
}
/* scroll-progress fill hugging the pill's lower edge */
.site__prog {
  position: absolute;
  left: 12%;
  right: 12%;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  transform: scaleX(clamp(0, var(--site-prog, 0), 1));
  transform-origin: 0 50%;
  transition: transform 0.12s linear;
  background: linear-gradient(90deg, var(--site-accent), color-mix(in srgb, var(--site-accent) 20%, transparent));
}
.site__brand {
  font-family: var(--site-display);
  font-weight: 700;
  letter-spacing: -0.01em;
  font-size: 1rem;
  color: var(--site-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: inline-flex;
  align-items: center;
}
.site__links {
  display: flex;
  gap: 0.15rem;
  overflow-x: auto;
}
.site__links button {
  flex: 0 0 auto;
  padding: 0.4rem 0.75rem;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 600;
  color: color-mix(in srgb, var(--site-ink) 62%, var(--site-bg));
  font-family: var(--site-body);
  transition:
    color 0.15s ease,
    background 0.15s ease;
}
.site__links button:hover {
  color: var(--site-accent-ink);
  background: var(--site-accent);
}
.site__burger {
  display: none;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 9px;
  color: var(--site-ink);
  background: color-mix(in srgb, var(--site-ink) 6%, transparent);
}
.site__bar-cta {
  flex: 0 0 auto;
  padding: 0.45rem 0.95rem;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 700;
  font-family: var(--site-body);
  color: var(--site-accent-ink);
  background: var(--site-accent);
  white-space: nowrap;
}

/* --- responsive one-page nav (collapses inside the site container) --- */
@container (max-width: 600px) {
  .site__bar {
    flex-wrap: wrap;
    padding: 0.6rem 0.7rem 0.6rem clamp(1rem, 5vw, 1.4rem);
    border-radius: 20px;
  }
  .site__bar--open {
    border-radius: 20px;
  }
  .site__prog {
    left: 8%;
    right: 8%;
  }
  .site__brand {
    order: 1;
    flex: 1;
  }
  .site__burger {
    order: 2;
    display: grid;
  }
  .site__bar-cta {
    order: 4;
    flex-basis: 100%;
    margin-top: 0.5rem;
  }
  .site__links {
    order: 3;
    flex-basis: 100%;
    flex-direction: column;
    gap: 0;
    overflow: hidden;
    max-height: 0;
    margin-top: 0;
    transition: max-height 0.28s ease;
  }
  .site__bar--open .site__links {
    max-height: 70vh;
    overflow-y: auto;
    margin-top: 0.5rem;
  }
  .site__links button {
    width: 100%;
    text-align: left;
    border-radius: 8px;
    padding: 0.75rem 0.7rem;
    font-size: 0.95rem;
  }
  .site__links button + button {
    border-top: 1px solid color-mix(in srgb, var(--site-ink) 8%, transparent);
  }
}

/* section rhythm + reveal */
.s {
  position: relative;
  padding: calc(clamp(2.75rem, 8vw, 5.5rem) * var(--site-density, 1)) var(--pad);
  /* anchor jumps land clear of the floating one-page navbar */
  scroll-margin-top: 5.5rem;
  /* owner per-section colour overrides (set via a keyed <style> block) — each
     section re-resolves the tokens at its own level so a --site-ink/--s-bg
     override actually re-tints this section's text + surface. */
  background: var(--s-bg, transparent);
  color: var(--site-ink);
}
.s :is(h1, h2, h3, h4) {
  color: var(--s-h, inherit);
}
/* Number only the sections that show a "01/02/…" heading kicker (below).
   Hero, the About intro and the CTA don't carry one. */
.s:not(.s--hero):not(.s--cta):not(.s--about) {
  counter-increment: sec;
}
.s + .s {
  border-top: 1px solid color-mix(in srgb, var(--site-ink) 7%, transparent);
}
.s h1,
.s h2,
.s h3 {
  font-family: var(--site-display);
  letter-spacing: -0.02em;
  line-height: 1.12;
  margin: 0;
}
.s p {
  line-height: 1.65;
}
/* `.s h2` (the shared reset) has more weight than a bare `.s__h`, so qualify. */
.s h2.s__h {
  font-size: clamp(1.5rem, 3.4vw, 2.15rem);
  /* The accent rule is a separate block in flow, not glued to the text: clear
     air above it (its own `margin-top`) to the heading, and a generous
     `margin-bottom` from the rule to the section content. */
  margin-bottom: 3.25rem;
}
/* mono section index kicker — "01", "02", … above each heading */
.s:not(.s--hero):not(.s--cta):not(.s--about) h2.s__h::before {
  content: counter(sec, decimal-leading-zero);
  display: block;
  margin-bottom: 0.85rem;
  font-family: var(--site-display);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.24em;
  color: var(--site-accent);
  opacity: 0.85;
}
.s h2.s__h::after {
  content: '';
  display: block;
  margin-top: 1.15rem;
  width: 48px;
  height: 3px;
  border-radius: 3px;
  background: linear-gradient(90deg, var(--site-accent), transparent);
}

/* scroll-reveal — the hero stays visible (it is above the fold).
   Distance/duration are tokens so `site--motion-lively` can scale them; each
   section's `data-anim` (set from the builder / AI) picks the entrance shape. */
.site__scroll--anim {
  --rv-dist: 20px;
  --rv-dur: 0.55s;
  --rv-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
.site--motion-lively .site__scroll--anim {
  --rv-dist: 40px;
  --rv-dur: 0.7s;
}
.site__scroll--anim .s:not(.s--hero) {
  opacity: 0;
  transform: translateY(var(--rv-dist));
  transition:
    opacity var(--rv-dur) var(--rv-ease),
    transform var(--rv-dur) var(--rv-ease),
    filter var(--rv-dur) var(--rv-ease);
}
.site__scroll--anim .s:not(.s--hero)[data-anim='fade'] {
  transform: none;
}
.site__scroll--anim .s:not(.s--hero)[data-anim='slideLeft'] {
  transform: translateX(var(--rv-dist));
}
.site__scroll--anim .s:not(.s--hero)[data-anim='slideRight'] {
  transform: translateX(calc(-1 * var(--rv-dist)));
}
.site__scroll--anim .s:not(.s--hero)[data-anim='zoom'] {
  transform: scale(0.94);
}
.site__scroll--anim .s:not(.s--hero)[data-anim='blur'] {
  transform: none;
  filter: blur(10px);
}
.site__scroll--anim .s:not(.s--hero)[data-anim='none'] {
  opacity: 1;
  transform: none;
  filter: none;
  transition: none;
}
.site__scroll--anim .s:not(.s--hero).is-in {
  opacity: 1;
  transform: none;
  filter: none;
}

/* staggered reveal for repeating section children */
.site__scroll--anim .s:not(.s--hero):not([data-anim='none'])
  :is(.card, .feat, .stat, .proc__step, .quote, .pcard, .ccard, .srow, .qa, .bento__c, .tl__i) {
  opacity: 0;
  transform: translateY(14px);
  transition:
    opacity 0.5s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}
.site__scroll--anim .s:not(.s--hero).is-in
  :is(.card, .feat, .stat, .proc__step, .quote, .pcard, .ccard, .srow, .qa, .bento__c, .tl__i) {
  opacity: 1;
  transform: none;
}
.site__scroll--anim .s.is-in :is(.card, .feat, .stat, .proc__step, .quote, .pcard, .ccard, .srow, .qa):nth-child(2) {
  transition-delay: 0.06s;
}
.site__scroll--anim .s.is-in :is(.card, .feat, .stat, .proc__step, .quote, .pcard, .ccard, .srow, .qa):nth-child(3) {
  transition-delay: 0.12s;
}
.site__scroll--anim .s.is-in :is(.card, .feat, .stat, .proc__step, .quote, .pcard, .ccard, .srow, .qa):nth-child(4) {
  transition-delay: 0.18s;
}
.site__scroll--anim .s.is-in :is(.card, .feat, .stat, .proc__step, .quote, .pcard, .ccard, .srow, .qa):nth-child(5) {
  transition-delay: 0.24s;
}
.site__scroll--anim .s.is-in :is(.card, .feat, .stat, .proc__step, .quote, .pcard, .ccard, .srow, .qa):nth-child(n + 6) {
  transition-delay: 0.3s;
}

/* HERO */
.s--hero {
  overflow: hidden;
  background: linear-gradient(180deg, var(--site-wash), var(--site-bg));
  text-align: center;
}
.s--hero__in {
  position: relative;
  z-index: 1;
}
.s--hero__aura {
  position: absolute;
  inset: -30% -10% auto -10%;
  height: 140%;
  background:
    radial-gradient(38% 40% at 22% 30%, color-mix(in srgb, var(--site-accent) 45%, transparent), transparent 70%),
    radial-gradient(34% 38% at 82% 20%, color-mix(in srgb, var(--site-ink) 30%, transparent), transparent 70%);
  filter: blur(10px);
  opacity: 0.5;
  animation: aura 12s ease-in-out infinite alternate;
}
@keyframes aura {
  to {
    transform: translate3d(3%, 4%, 0) scale(1.08);
  }
}
.s--hero--photo {
  background-size: cover;
  background-position: center;
  /* dark base behind the photo — a bright or broken image still reads white */
  background-color: #101119;
  color: #fff;
  padding-block: clamp(4.5rem, 13vw, 9rem);
}
.s--hero--photo .s--hero__in {
  text-shadow: 0 2px 22px rgba(0, 0, 0, 0.55);
}
.s--hero--photo h1 {
  color: #fff;
}
.s--hero--photo .s--hero__eyebrow {
  color: rgba(255, 255, 255, 0.85);
}
.s--hero--photo .s--hero__sub {
  color: rgba(255, 255, 255, 0.92);
}
.s--hero--photo .btn--ghost {
  border-color: rgba(255, 255, 255, 0.6);
  color: #fff;
}
.s--hero__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 12px;
  color: var(--site-accent);
  font-weight: 700;
  margin: 0 0 1rem;
}
.s--hero h1 {
  font-size: clamp(2rem, 5.4vw, 3.4rem);
  max-width: 20ch;
  margin-inline: auto;
}
.s--hero__sub {
  max-width: 54ch;
  margin: 1.2rem auto 1.9rem;
  color: color-mix(in srgb, var(--site-ink) 72%, var(--site-bg));
  font-size: 1.06rem;
}
.s--hero__cta {
  display: flex;
  gap: 0.8rem;
  justify-content: center;
  flex-wrap: wrap;
}
.s--hero__cue {
  position: absolute;
  left: 50%;
  bottom: 1rem;
  transform: translateX(-50%);
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  color: currentColor;
  opacity: 0.55;
  cursor: pointer;
  animation: cue 1.8s ease-in-out infinite;
}
@keyframes cue {
  50% {
    transform: translate(-50%, 5px);
    opacity: 0.9;
  }
}

/* hero — left-aligned variant (template) */
.s--hero--left {
  text-align: left;
}
.s--hero--left .s--hero__in {
  max-width: 46rem;
  margin-inline: 0;
}
.s--hero--left h1 {
  margin-inline: 0;
  max-width: 16ch;
  font-size: clamp(2.2rem, 6vw, 3.9rem);
}
.s--hero--left .s--hero__sub {
  margin-inline: 0;
}
.s--hero--left .s--hero__cta {
  justify-content: flex-start;
}
.s--hero--left .s--hero__cue {
  left: var(--pad);
  transform: none;
}
.s--hero--left.s--hero--photo .s--hero__cue {
  left: var(--pad);
}
@keyframes cue-left {
  50% {
    transform: translateY(5px);
    opacity: 0.9;
  }
}
.s--hero--left .s--hero__cue {
  animation-name: cue-left;
}

.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.8rem 1.5rem;
  border-radius: var(--site-btn-radius);
  font-weight: 600;
  font-size: 0.95rem;
  transition:
    transform 0.16s ease,
    box-shadow 0.16s ease,
    background 0.16s ease;
}
.btn--solid {
  background: var(--site-accent);
  color: var(--site-accent-ink);
  box-shadow: 0 12px 28px -14px var(--site-accent);
}
.btn--solid:hover {
  transform: translateY(-1px);
  box-shadow: 0 18px 40px -16px var(--site-accent);
}
/* button-style variants (Advanced builder theme) */
.site--btn-outline .btn--solid {
  background: transparent;
  color: var(--site-accent);
  border: 1.5px solid var(--site-accent);
  box-shadow: none;
}
.site--btn-outline .btn--solid:hover {
  background: color-mix(in srgb, var(--site-accent) 12%, transparent);
}
.site--btn-soft .btn--solid {
  background: color-mix(in srgb, var(--site-accent) 16%, transparent);
  color: var(--site-accent);
  box-shadow: none;
}
.site--btn-soft .btn--solid:hover {
  background: color-mix(in srgb, var(--site-accent) 24%, transparent);
}
.btn--ghost {
  border: 1px solid color-mix(in srgb, var(--site-ink) 25%, var(--site-bg));
}

/* ABOUT */
.s--about {
  text-align: center;
  background: linear-gradient(180deg, var(--site-bg), var(--site-wash));
}
.s--about__in {
  max-width: 60ch;
  margin-inline: auto;
}
.s--about__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 12px;
  font-weight: 700;
  color: var(--site-accent);
  margin: 0 0 1rem;
}
.s--about__body {
  font-size: clamp(1.1rem, 2.2vw, 1.4rem);
  line-height: 1.6;
  color: color-mix(in srgb, var(--site-ink) 82%, var(--site-bg));
}

/* STATS / NUMBERS BAND — dark glass with a drifting accent glow */
.s--stats {
  position: relative;
  overflow: hidden;
  color: #fff;
  background:
    radial-gradient(
      120% 140% at 0% 0%,
      color-mix(in srgb, var(--site-accent) 26%, var(--site-ink)),
      var(--site-ink) 70%
    );
}
.s--stats::before {
  content: '';
  position: absolute;
  inset: -40% 30% auto -20%;
  height: 150%;
  background: radial-gradient(
    38% 40% at 30% 30%,
    color-mix(in srgb, var(--site-accent) 60%, transparent),
    transparent 70%
  );
  filter: blur(20px);
  opacity: 0.55;
  animation: aura 14s ease-in-out infinite alternate;
  pointer-events: none;
}
.s--stats h2.s__h {
  color: #fff;
  position: relative;
}
.s--stats h2.s__h::before {
  color: color-mix(in srgb, var(--site-accent) 55%, var(--site-bg));
  opacity: 1;
}
.stats {
  position: relative;
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
}
.stat {
  text-align: center;
  padding: 1.5rem 1rem;
  border-radius: calc(var(--site-radius) + 8px);
  background: color-mix(in srgb, #fff 7%, transparent);
  border: 1px solid color-mix(in srgb, #fff 14%, transparent);
  backdrop-filter: blur(6px);
}
.stat__v {
  display: block;
  font-family: var(--site-display);
  font-weight: 700;
  letter-spacing: -0.02em;
  font-size: clamp(1.9rem, 5vw, 3rem);
  line-height: 1;
  background: linear-gradient(180deg, var(--site-bg), color-mix(in srgb, var(--site-accent) 55%, var(--site-bg)));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.stat__l {
  display: block;
  margin-top: 0.5rem;
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.72);
}

/* PROCESS / HOW WE WORK — a numbered vertical stepper */
.s--process {
  background:
    radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--site-ink) 6%, transparent) 1px, transparent 0)
      0 0 / 24px 24px,
    linear-gradient(180deg, var(--site-bg), var(--site-wash));
}
.proc {
  list-style: none;
  margin: 0;
  padding: 0;
  max-width: 46rem;
}
.proc__step {
  position: relative;
  display: flex;
  gap: 1.2rem;
  padding-bottom: 1.9rem;
}
.proc__step:last-child {
  padding-bottom: 0;
}
.proc__step::before {
  content: '';
  position: absolute;
  left: 21px;
  top: 46px;
  bottom: 0;
  width: 2px;
  background: color-mix(in srgb, var(--site-accent) 32%, transparent);
}
.proc__step:last-child::before {
  display: none;
}
.proc__n {
  flex: none;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  font-family: var(--site-display);
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--site-accent-ink);
  background: var(--site-accent);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--site-accent) 14%, transparent);
}
.proc__t {
  padding-top: 0.35rem;
  min-width: 0;
}
.proc__t h3 {
  font-family: var(--site-display);
  font-size: 1.12rem;
  margin-bottom: 0.35rem;
}
.proc__t p {
  margin: 0;
  font-size: 0.92rem;
  color: color-mix(in srgb, var(--site-ink) 62%, var(--site-bg));
  max-width: 56ch;
}

/* FEATURES / WHY US */
.s--feats {
  background:
    radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--site-ink) 6%, transparent) 1px, transparent 0)
      0 0 / 24px 24px,
    var(--site-wash);
}
.feats {
  display: grid;
  gap: 0.9rem;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}
.feat {
  display: flex;
  gap: 0.9rem;
  align-items: flex-start;
  padding: 1.2rem;
  background: var(--site-surface);
  border: 1px solid color-mix(in srgb, var(--site-ink) 10%, transparent);
  border-radius: calc(var(--site-radius) + 4px);
}
.feat__ic {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 11px;
  color: var(--site-accent-ink);
  background: var(--site-accent);
}
.feat strong {
  font-family: var(--site-display);
  font-size: 1rem;
}
.feat p {
  margin: 0.2rem 0 0;
  font-size: 0.88rem;
  color: color-mix(in srgb, var(--site-ink) 60%, var(--site-bg));
}

/* SERVICES */
.s--services {
  background:
    radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--site-ink) 6%, transparent) 1px, transparent 0)
      0 0 / 24px 24px,
    var(--site-wash);
}
.cards {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}
.card {
  position: relative;
  flex: 1 1 240px;
  max-width: 360px;
  padding: 1.5rem 1.4rem 1.4rem;
  background: var(--site-surface);
  border: 1px solid color-mix(in srgb, var(--site-ink) 10%, transparent);
  border-radius: calc(var(--site-radius) + 4px);
  box-shadow: var(--site-shadow);
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    border-color 0.18s ease;
}
.card:hover {
  transform: translateY(-4px);
  border-color: color-mix(in srgb, var(--site-accent) 40%, transparent);
  box-shadow: 0 18px 40px -22px var(--site-accent);
}
.card__ic {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border-radius: 13px;
  color: var(--site-accent);
  background: color-mix(in srgb, var(--site-accent) 13%, var(--site-bg));
  margin-bottom: 0.9rem;
}
.card__n {
  position: absolute;
  top: 1.1rem;
  right: 1.2rem;
  font-family: var(--site-display);
  font-weight: 700;
  font-size: 0.8rem;
  color: color-mix(in srgb, var(--site-ink) 28%, var(--site-bg));
  letter-spacing: 0.04em;
}
.card h3 {
  font-size: 1.06rem;
  margin-bottom: 0.4rem;
}
.card p {
  font-size: 0.9rem;
  color: color-mix(in srgb, var(--site-ink) 62%, var(--site-bg));
}

/* SERVICES — list layout (template variation) */
.slist {
  display: flex;
  flex-direction: column;
}
.srow {
  display: flex;
  gap: 1.2rem;
  align-items: flex-start;
  padding: 1.6rem 0;
  border-top: 1px solid color-mix(in srgb, var(--site-ink) 12%, transparent);
}
.srow:last-child {
  border-bottom: 1px solid color-mix(in srgb, var(--site-ink) 12%, transparent);
}
.srow__ic {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  flex: none;
  border-radius: 13px;
  color: var(--site-accent-ink);
  background: var(--site-accent);
}
.srow__t {
  flex: 1;
  min-width: 0;
}
.srow__t h3 {
  font-size: 1.15rem;
  margin-bottom: 0.3rem;
}
.srow__t p {
  font-size: 0.95rem;
  color: color-mix(in srgb, var(--site-ink) 62%, var(--site-bg));
  max-width: 60ch;
}
.srow__n {
  flex: none;
  font-family: var(--site-display);
  font-weight: 700;
  font-size: 1.1rem;
  color: color-mix(in srgb, var(--site-ink) 22%, var(--site-bg));
}

/* PORTFOLIO */
.s--gallery {
  background: linear-gradient(180deg, var(--site-bg), var(--site-wash));
}
.pfolio {
  display: flex;
  flex-wrap: wrap;
  gap: 0.9rem;
}
.pcard {
  margin: 0;
  flex: 1 1 220px;
  max-width: 340px;
  border-radius: calc(var(--site-radius) + 2px);
  overflow: hidden;
  background: var(--site-surface);
  border: 1px solid color-mix(in srgb, var(--site-ink) 10%, transparent);
}
.pcard img,
.pcard__ph {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}
.pcard:hover img {
  transform: scale(1.06);
}
.pcard__ph {
  background: linear-gradient(135deg, var(--site-wash), var(--site-accent));
  opacity: 0.55;
}
.pcard figcaption {
  padding: 0.65rem 0.85rem;
  font-size: 0.82rem;
  color: color-mix(in srgb, var(--site-ink) 60%, var(--site-bg));
}

/* advanced multi-page grids (kept) */
.grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}
.grid--2 {
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}

/* TESTIMONIALS */
.quotes {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}
.quote {
  position: relative;
  margin: 0;
  flex: 1 1 280px;
  max-width: 420px;
  padding: 1.6rem 1.5rem 1.3rem;
  background: var(--site-surface);
  border: 1px solid color-mix(in srgb, var(--site-ink) 10%, transparent);
  border-radius: calc(var(--site-radius) + 6px);
  box-shadow: var(--site-shadow);
}
.quote__mark {
  position: absolute;
  top: -0.3rem;
  right: 1rem;
  font-family: var(--site-display);
  font-size: 3.5rem;
  line-height: 1;
  color: color-mix(in srgb, var(--site-accent) 30%, var(--site-bg));
}
.quote blockquote {
  margin: 0;
  font-size: 0.98rem;
  line-height: 1.6;
}
.quote figcaption {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-top: 1rem;
  font-size: 0.85rem;
  font-weight: 600;
}
.quote__av {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--site-accent);
  color: var(--site-accent-ink);
  font-size: 0.85rem;
}

/* FAQ */
.s--faq {
  max-width: 62ch;
}
.qa {
  border-top: 1px solid color-mix(in srgb, var(--site-ink) 12%, transparent);
}
.qa:last-of-type {
  border-bottom: 1px solid color-mix(in srgb, var(--site-ink) 12%, transparent);
}
.qa summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.1rem 0;
  cursor: pointer;
  font-family: var(--site-display);
  font-size: 1rem;
  list-style: none;
}
.qa summary::-webkit-details-marker {
  display: none;
}
.qa__pl {
  flex: none;
  color: var(--site-accent);
  transition: transform 0.2s ease;
}
.qa[open] .qa__pl {
  transform: rotate(45deg);
}
.qa p {
  margin: 0;
  padding: 0 0 1.1rem;
  color: color-mix(in srgb, var(--site-ink) 60%, var(--site-bg));
  font-size: 0.92rem;
}

/* CONTACT */
.ccards {
  display: flex;
  flex-wrap: wrap;
  gap: 0.9rem;
  margin-bottom: 1.8rem;
}
.ccard {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  flex: 1 1 190px;
  max-width: 280px;
  padding: 1.2rem 1.2rem 1.1rem;
  border-radius: calc(var(--site-radius) + 4px);
  background: var(--site-surface);
  border: 1px solid color-mix(in srgb, var(--site-ink) 10%, transparent);
  border-top: 3px solid var(--site-accent);
  color: inherit;
  text-decoration: none;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease;
}
a.ccard:hover {
  transform: translateY(-3px);
  box-shadow: 0 16px 36px -22px var(--site-accent);
}
.ccard__ic {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 11px;
  color: var(--site-accent);
  background: color-mix(in srgb, var(--site-accent) 13%, var(--site-bg));
  margin-bottom: 0.55rem;
}
.ccard__k {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
  color: color-mix(in srgb, var(--site-ink) 45%, var(--site-bg));
}
.ccard__v {
  font-weight: 600;
  word-break: break-word;
}

.cform {
  max-width: 34rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 1.4rem;
  border-radius: calc(var(--site-radius) + 4px);
  background: var(--site-surface);
  border: 1px solid color-mix(in srgb, var(--site-ink) 10%, transparent);
}
.cform__lead {
  margin: 0 0 0.2rem;
  font-weight: 600;
}
.cform__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}
@media (max-width: 520px) {
  .cform__row {
    grid-template-columns: 1fr;
  }
}
.cform input,
.cform textarea {
  width: 100%;
  padding: 0.65rem 0.8rem;
  border: 1px solid color-mix(in srgb, var(--site-ink) 22%, var(--site-bg));
  border-radius: var(--site-radius);
  font: inherit;
  font-size: 0.92rem;
  background: var(--site-surface);
  color: var(--site-ink);
}
.cform input:focus,
.cform textarea:focus {
  outline: 2px solid var(--site-accent);
  outline-offset: 1px;
  border-color: transparent;
}
.cform textarea {
  resize: vertical;
}
.cform .btn {
  align-self: flex-start;
  border: 0;
  cursor: pointer;
}
.cform .btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.cform__err {
  margin: 0;
  color: #c0362c;
  font-size: 0.85rem;
}
.cform__ok {
  margin-top: 1.4rem;
  font-weight: 600;
  color: var(--site-accent);
}
.cform--preview {
  position: relative;
}
.cform--preview input,
.cform--preview textarea {
  opacity: 0.75;
}
.cform__note {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  color: var(--site-ink-soft);
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.cform__note::before {
  content: '👁';
  font-size: 0.9rem;
}

/* CTA */
.s--cta {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(60% 120% at 50% 0%, color-mix(in srgb, var(--site-accent) 55%, var(--site-ink)), var(--site-ink));
  color: #fff;
  text-align: center;
}
.s--cta__glow {
  position: absolute;
  inset: -40% -10% auto -10%;
  height: 120%;
  background: radial-gradient(
    40% 50% at 50% 0%,
    color-mix(in srgb, var(--site-accent) 60%, transparent),
    transparent 70%
  );
  filter: blur(20px);
  opacity: 0.7;
}
.s--cta h2.s__h {
  margin-inline: auto;
  font-size: clamp(1.6rem, 4vw, 2.5rem);
  max-width: 24ch;
}
.s--cta h2.s__h::after {
  margin-inline: auto;
  background: linear-gradient(90deg, transparent, var(--site-bg), transparent);
}
.s--cta__btn {
  position: relative;
  background: var(--site-surface);
  color: var(--site-ink);
  border: 0;
  cursor: pointer;
  box-shadow: 0 12px 30px -12px rgba(0, 0, 0, 0.5);
}

/* one-page footer */
/* ============ site footer ============ */
.site__foot {
  position: relative;
  background: color-mix(in srgb, var(--site-accent) 10%, #0b0c11);
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.88rem;
}
.site__foot--pick {
  cursor: pointer;
  outline: 2px solid transparent;
  outline-offset: -2px;
  transition: outline-color 0.12s ease;
}
.site__foot--pick:hover {
  outline-color: color-mix(in srgb, var(--site-accent) 55%, transparent);
}
.site__foot--sel {
  outline-color: var(--site-accent) !important;
}
.site__foot-social {
  display: flex;
  flex-wrap: wrap;
  gap: 0.9rem;
  margin-top: 0.3rem;
}
.site__foot-social a {
  color: rgba(255, 255, 255, 0.78);
  font-size: 0.82rem;
  text-decoration: none;
}
.site__foot-social a:hover {
  color: #fff;
}
.site__foot-in {
  display: grid;
  grid-template-columns: 1.6fr 1fr 1fr 1fr;
  gap: clamp(1.4rem, 4vw, 3rem);
  padding: clamp(2.5rem, 6vw, 4rem) var(--pad) clamp(1.8rem, 4vw, 2.6rem);
}
.site__foot-col {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}
.site__foot-col--brand {
  gap: 0.7rem;
}
.site__foot-brand {
  font-family: var(--site-display);
  font-weight: 700;
  font-size: 1.35rem;
  letter-spacing: -0.02em;
  color: #fff;
}
.site__foot-blurb {
  margin: 0;
  max-width: 42ch;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.6);
}
.site__foot-h {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.45);
  margin-bottom: 0.15rem;
}
.site__foot-col button {
  align-self: flex-start;
  padding: 0;
  font: inherit;
  text-align: left;
  color: rgba(255, 255, 255, 0.72);
  transition: color 0.15s ease;
}
.site__foot-col button:hover {
  color: #fff;
}
.site__foot-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1.5rem;
  padding: 1.1rem var(--pad);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.5);
}
.site__foot-made {
  opacity: 0.8;
}
@container (max-width: 640px) {
  .site__foot-in {
    grid-template-columns: 1fr 1fr;
  }
  .site__foot-col--brand {
    grid-column: 1 / -1;
  }
}

/* ============ Advanced builder: editable preview ============ */
.site__scroll--edit .s {
  cursor: pointer;
}
.site__scroll--edit .s::after {
  content: '';
  position: absolute;
  inset: 3px;
  border: 1.5px dashed transparent;
  border-radius: 10px;
  pointer-events: none;
  transition: border-color 0.12s ease;
}
.site__scroll--edit .s:hover::after {
  border-color: color-mix(in srgb, var(--site-accent) 55%, transparent);
}
.site__scroll--edit .s.s--sel::after {
  border-style: solid;
  border-color: var(--site-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--site-accent) 22%, transparent);
}

/* ============ ABOUT variants (image beside the text) ============ */
.s--about--imageRight,
.s--about--imageLeft,
.s--about--twoCol {
  text-align: left;
  display: grid;
  gap: clamp(1.5rem, 5vw, 3.5rem);
  align-items: center;
  grid-template-columns: 1fr 1fr;
}
.s--about--imageLeft .s--about__in {
  order: 2;
}
.s--about--imageRight .s--about__in,
.s--about--imageLeft .s--about__in,
.s--about--twoCol .s--about__in {
  margin-inline: 0;
  max-width: none;
}
.s--about__img img {
  display: block;
  width: 100%;
  border-radius: calc(var(--site-radius) + 6px);
  object-fit: cover;
  aspect-ratio: 4 / 3;
}
.s--about--twoCol .s--about__img {
  display: none;
}
@container (max-width: 720px) {
  .s--about--imageRight,
  .s--about--imageLeft,
  .s--about--twoCol {
    grid-template-columns: 1fr;
  }
  .s--about--imageLeft .s--about__in {
    order: 0;
  }
}

/* ============ LOGOS ============ */
.s--logos {
  text-align: center;
  background: var(--site-wash);
}
.s--logos__t {
  margin: 0 0 1.4rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--site-ink) 45%, var(--site-bg));
}
.logos {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: clamp(1.2rem, 5vw, 3.5rem);
}
.logo {
  font-family: var(--site-display);
  font-weight: 700;
  font-size: 1.05rem;
  color: color-mix(in srgb, var(--site-ink) 55%, var(--site-bg));
}
.logo img {
  display: block;
  max-height: 38px;
  width: auto;
  filter: grayscale(1);
  opacity: 0.7;
}
.s--logos--grid .logos {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 1rem;
}
.s--logos--grid .logo {
  padding: 1.1rem;
  border: 1px solid color-mix(in srgb, var(--site-ink) 10%, transparent);
  border-radius: calc(var(--site-radius) + 2px);
}

/* ============ FEATURE SPLIT ============ */
.fsrow {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: clamp(1.5rem, 5vw, 3.5rem);
  align-items: center;
}
.fsrow + .fsrow {
  margin-top: clamp(2rem, 6vw, 4rem);
}
.fsrow--rev .fsrow__media {
  order: 2;
}
.fsrow__media img,
.fsrow__ph {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: calc(var(--site-radius) + 6px);
}
.fsrow__ph {
  background: linear-gradient(135deg, var(--site-wash), color-mix(in srgb, var(--site-accent) 45%, var(--site-bg)));
}
.fsrow__txt h3 {
  font-family: var(--site-display);
  font-size: clamp(1.2rem, 3vw, 1.7rem);
  margin-bottom: 0.6rem;
}
.fsrow__txt p {
  color: color-mix(in srgb, var(--site-ink) 70%, var(--site-bg));
}
.s--fsplit--stacked .fsrow {
  grid-template-columns: 1fr;
}
@container (max-width: 720px) {
  .fsrow {
    grid-template-columns: 1fr;
  }
  .fsrow--rev .fsrow__media {
    order: 0;
  }
}

/* ============ TEAM ============ */
.team {
  display: grid;
  gap: 1.1rem;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}
.tm {
  margin: 0;
  text-align: center;
  padding: 1.4rem 1rem;
  border: 1px solid color-mix(in srgb, var(--site-ink) 10%, transparent);
  border-radius: calc(var(--site-radius) + 6px);
  background: var(--site-surface);
}
.tm__ph {
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  margin: 0 auto 0.8rem;
  border-radius: 50%;
  overflow: hidden;
  font-family: var(--site-display);
  font-weight: 700;
  font-size: 1.5rem;
  color: var(--site-accent-ink);
  background: var(--site-accent);
}
.tm__ph img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tm figcaption strong {
  font-family: var(--site-display);
  font-size: 1rem;
}
.tm__role {
  display: block;
  font-size: 0.82rem;
  color: var(--site-accent);
  font-weight: 600;
  margin-top: 0.15rem;
}
.tm__bio {
  display: block;
  margin-top: 0.5rem;
  font-size: 0.85rem;
  color: color-mix(in srgb, var(--site-ink) 62%, var(--site-bg));
}
.s--team--compact .tm {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  text-align: left;
  padding: 0.9rem 1rem;
}
.s--team--compact .tm__ph {
  width: 48px;
  height: 48px;
  margin: 0;
  font-size: 1.1rem;
}
.s--team--compact .tm__bio {
  display: none;
}

/* ============ PRICING ============ */
.price {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  align-items: start;
}
.tier {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 1.6rem 1.4rem;
  border: 1px solid color-mix(in srgb, var(--site-ink) 12%, transparent);
  border-radius: calc(var(--site-radius) + 8px);
  background: var(--site-surface);
}
.tier--hi {
  border-color: var(--site-accent);
  box-shadow: 0 20px 50px -26px var(--site-accent);
  transform: translateY(-4px);
}
.tier__name {
  font-family: var(--site-display);
  font-size: 1.05rem;
}
.tier__price {
  font-family: var(--site-display);
  font-weight: 700;
  font-size: clamp(1.8rem, 4vw, 2.4rem);
  letter-spacing: -0.02em;
}
.tier__price em {
  font-size: 0.9rem;
  font-weight: 500;
  font-style: normal;
  color: color-mix(in srgb, var(--site-ink) 55%, var(--site-bg));
  margin-left: 0.2rem;
}
.tier__feats {
  list-style: none;
  margin: 0.4rem 0 0.8rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.9rem;
}
.tier__feats li {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: color-mix(in srgb, var(--site-ink) 72%, var(--site-bg));
}
.tier__feats .v-icon {
  color: var(--site-accent);
}
.tier__cta {
  align-self: flex-start;
  margin-top: auto;
}

/* ============ RICH TEXT ============ */
.s--rich {
  max-width: 68ch;
}
.s--rich--wide {
  max-width: none;
}
.rich p {
  margin: 0 0 1rem;
  font-size: 1.02rem;
  color: color-mix(in srgb, var(--site-ink) 82%, var(--site-bg));
}

/* ============ CUSTOM (owner-assembled block stack) ============ */
.s--custom__in {
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
.s--custom--w-narrow .s--custom__in {
  max-width: 620px;
}
.s--custom--w-standard .s--custom__in {
  max-width: 820px;
}
.s--custom--w-wide .s--custom__in {
  max-width: 1120px;
}
.s--custom--w-full .s--custom__in {
  max-width: none;
}
.s--custom--center .s--custom__in {
  text-align: center;
  align-items: center;
}
/* background treatments */
.s--custom--bg-surface {
  background: var(--site-surface);
}
.s--custom--bg-wash {
  background: var(--site-wash);
}
.s--custom--bg-accent {
  background: var(--site-accent);
  color: var(--site-accent-ink);
}
.s--custom--bg-ink {
  background: var(--site-ink);
  color: var(--site-bg);
}
.s--custom--bg-accent .s--custom__h,
.s--custom--bg-ink .s--custom__h {
  color: inherit;
}
.s--custom--bg-accent .s--custom__tx p,
.s--custom--bg-ink .s--custom__tx p {
  color: inherit;
  opacity: 0.92;
}
.s--custom--bg-accent .btn--solid,
.s--custom--bg-ink .btn--solid {
  background: var(--site-bg);
  color: var(--site-ink);
}
.s--custom--bg-accent .btn--ghost,
.s--custom--bg-ink .btn--ghost {
  border-color: currentColor;
  color: currentColor;
}
/* card / bordered variants wrap the inner stack */
.s--custom--card .s--custom__in,
.s--custom--bordered .s--custom__in {
  padding: clamp(1.5rem, 4vw, 2.75rem);
  border-radius: var(--site-radius);
}
.s--custom--card .s--custom__in {
  background: var(--site-surface);
  box-shadow: var(--site-shadow);
}
.s--custom--bordered .s--custom__in {
  border: 1px solid var(--site-border);
}
/* blocks */
.s--custom__h {
  font-family: var(--site-display);
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0.2rem 0 0.6rem;
}
.s--custom__h--lg {
  font-size: clamp(1.7rem, 3.8vw, 2.5rem);
}
.s--custom__h--md {
  font-size: clamp(1.3rem, 2.6vw, 1.7rem);
}
.s--custom__h--sm {
  font-size: 1.05rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--site-ink-soft);
}
.s--custom__tx p {
  margin: 0 0 1rem;
  font-size: 1.02rem;
  line-height: 1.65;
  color: color-mix(in srgb, var(--site-ink) 82%, var(--site-bg));
}
.s--custom__tx p:last-child {
  margin-bottom: 0;
}
.s--custom__fig {
  margin: 0.5rem 0;
}
.s--custom__fig img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: var(--site-radius);
}
.s--custom__fig figcaption {
  margin-top: 0.5rem;
  font-size: 0.85rem;
  color: var(--site-ink-soft);
}
.s--custom__btnw {
  margin: 0.7rem 0;
}
.s--custom--center .s--custom__btnw {
  display: flex;
  justify-content: center;
}
.s--custom__hr {
  width: 100%;
  height: 0;
  border: 0;
  border-top: 1px solid var(--site-border);
  margin: 1.2rem 0;
}
.s--custom__sp--sm {
  height: 1rem;
}
.s--custom__sp--md {
  height: 2.5rem;
}
.s--custom__sp--lg {
  height: 4.5rem;
}

/* ============ BIG STATEMENT ============ */
.stmt {
  max-width: 60ch;
  margin-inline: auto;
  text-align: center;
}
.stmt__t {
  margin: 0;
  font-family: var(--site-display);
  font-weight: 600;
  font-size: clamp(1.5rem, 4vw, 2.6rem);
  line-height: 1.28;
  letter-spacing: -0.02em;
}
.stmt__l {
  list-style: none;
  margin: 1.6rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem 1.4rem;
  justify-content: center;
}
.stmt__l li {
  position: relative;
  padding-left: 1.3rem;
  font-size: 0.95rem;
  color: var(--site-ink-soft);
}
.stmt__l li::before {
  content: '✓';
  position: absolute;
  left: 0;
  color: var(--site-accent);
  font-weight: 700;
}
.s--bigStatement--boxed .stmt {
  max-width: 760px;
  padding: clamp(2rem, 5vw, 3.5rem);
  border-radius: var(--site-radius);
  background: var(--site-surface);
  box-shadow: var(--site-shadow);
}

/* ============ HIGHLIGHTS ROW ============ */
.hl {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 1rem 2rem;
}
.hl__i {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  font-weight: 600;
  font-size: 0.98rem;
}
.hl__i .v-icon {
  color: var(--site-accent);
}
.s--highlightsRow--divided .hl {
  gap: 0;
}
.s--highlightsRow--divided .hl__i {
  padding: 0.2rem 1.6rem;
}
.s--highlightsRow--divided .hl__i + .hl__i {
  border-left: 1px solid var(--site-border);
}

/* ============ RATING BAND ============ */
.rate {
  display: flex;
  align-items: center;
  gap: clamp(1rem, 4vw, 2.5rem);
  max-width: 900px;
  margin-inline: auto;
}
.s--ratingBand--center .rate {
  flex-direction: column;
  text-align: center;
}
.rate__score {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: none;
}
.rate__n {
  font-family: var(--site-display);
  font-weight: 700;
  font-size: clamp(2.4rem, 7vw, 3.6rem);
  line-height: 1;
}
.rate__stars {
  color: var(--site-accent);
  letter-spacing: 0.14em;
  font-size: 1rem;
  margin: 0.35rem 0 0.2rem;
}
.rate__meta {
  font-size: 0.82rem;
  color: var(--site-ink-soft);
}
.rate__t {
  margin: 0;
  font-size: clamp(1.05rem, 2.4vw, 1.35rem);
  line-height: 1.5;
}

/* ============ VIDEO ============ */
.s--video .s__h {
  text-align: center;
}
.vid {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 16 / 9;
  max-width: 960px;
  margin: 1.4rem auto 0;
  border-radius: var(--site-radius);
  overflow: hidden;
  background:
    radial-gradient(60% 90% at 50% 50%, color-mix(in srgb, var(--site-accent) 24%, #0b0c11), #0b0c11);
  background-size: cover;
  background-position: center;
}
.vid--live {
  cursor: pointer;
}
.s--video--boxed .vid {
  max-width: 720px;
}
.vid__play {
  display: grid;
  place-items: center;
  width: 74px;
  height: 74px;
  border-radius: 50%;
  color: #0b0c11;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 12px 40px -10px rgba(0, 0, 0, 0.6);
  transition: transform 0.16s ease;
}
.vid:hover .vid__play {
  transform: scale(1.08);
}
.vid__cap {
  margin: 0.7rem 0 0;
  text-align: center;
  font-size: 0.85rem;
  color: var(--site-ink-soft);
}

/* ============ SHOWCASE ============ */
.s--showcase {
  background-color: #101119;
  background-size: cover;
  background-position: center;
  color: #fff;
}
.s--showcase:not(.s--showcase--photo) {
  background: linear-gradient(135deg, color-mix(in srgb, var(--site-accent) 60%, #0b0b12), #0b0b12);
}
.show__in {
  max-width: 620px;
}
.s--showcase--center .show__in {
  max-width: 720px;
  margin-inline: auto;
  text-align: center;
}
.show__in h2 {
  color: #fff;
  font-size: clamp(1.8rem, 4.5vw, 3rem);
  margin: 0 0 0.8rem;
}
.show__in p {
  margin: 0 0 1.4rem;
  font-size: 1.05rem;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.85);
}

/* ============ BEFORE / AFTER ============ */
.s--beforeAfter .s__h {
  text-align: center;
}
.ba {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  max-width: 1000px;
  margin: 1.4rem auto 0;
}
.s--beforeAfter--stacked .ba {
  grid-template-columns: 1fr;
  max-width: 640px;
}
.ba__c {
  position: relative;
  margin: 0;
  border-radius: var(--site-radius);
  overflow: hidden;
  background: var(--site-wash);
}
.ba__c img,
.ba__ph {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
}
.ba__ph {
  background: repeating-linear-gradient(
    45deg,
    var(--site-border) 0 10px,
    transparent 10px 20px
  );
}
.ba__c figcaption {
  position: absolute;
  left: 0.7rem;
  top: 0.7rem;
  padding: 0.25rem 0.7rem;
  border-radius: 999px;
  font-size: 0.74rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #fff;
  background: rgba(11, 12, 20, 0.7);
  backdrop-filter: blur(4px);
}
.ba__c--after figcaption {
  background: color-mix(in srgb, var(--site-accent) 82%, rgba(0, 0, 0, 0.45));
}

/* ============ TABS ============ */
.tabx {
  max-width: 940px;
  margin-inline: auto;
}
.tabx__bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  border-bottom: 1px solid var(--site-border);
}
.tabx__b {
  padding: 0.6rem 1rem;
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--site-ink-soft);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.tabx__b.is-on {
  color: var(--site-accent);
  border-bottom-color: var(--site-accent);
}
.s--tabs--pill .tabx__bar {
  border: 0;
  gap: 0.5rem;
}
.s--tabs--pill .tabx__b {
  border: 1px solid var(--site-border);
  border-radius: 999px;
}
.s--tabs--pill .tabx__b.is-on {
  color: var(--site-accent-ink);
  background: var(--site-accent);
  border-color: var(--site-accent);
}
.tabx__panel {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.4rem;
  padding-top: 1.6rem;
}
.tabx__panel:has(.tabx__img) {
  grid-template-columns: 1.3fr 1fr;
}
.tabx__txt p {
  margin: 0 0 0.9rem;
  line-height: 1.6;
  color: color-mix(in srgb, var(--site-ink) 84%, var(--site-bg));
}
.tabx__img {
  width: 100%;
  height: 100%;
  max-height: 320px;
  object-fit: cover;
  border-radius: var(--site-radius);
}

/* ============ OPENING HOURS ============ */
.s--hours .s__h {
  text-align: center;
}
.hrs {
  width: 100%;
  max-width: 440px;
  margin: 1.2rem auto 0;
  border-collapse: collapse;
}
.s--hours--card .hrs {
  padding: 0.5rem 1.2rem;
  border-radius: var(--site-radius);
  background: var(--site-surface);
  box-shadow: var(--site-shadow);
}
.hrs th,
.hrs td {
  padding: 0.7rem 0.4rem;
  border-bottom: 1px solid var(--site-border);
  font-size: 0.95rem;
}
.hrs th {
  text-align: left;
  font-weight: 600;
}
.hrs td {
  text-align: right;
  color: var(--site-ink-soft);
}
.hrs tr:last-child th,
.hrs tr:last-child td {
  border-bottom: 0;
}
.hrs__note {
  margin: 0.8rem 0 0;
  text-align: center;
  font-size: 0.83rem;
  color: var(--site-ink-soft);
}

/* ============ CASE STUDY ============ */
.s--caseStudy {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: clamp(1.5rem, 5vw, 3.5rem);
  align-items: center;
}
.s--caseStudy--rev .cse__media {
  order: 2;
}
.cse__media {
  position: relative;
}
.cse__media img,
.cse__ph {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: var(--site-radius);
}
.cse__ph {
  background: var(--site-wash);
}
.cse__metric {
  position: absolute;
  right: -0.6rem;
  bottom: -0.6rem;
  padding: 0.9rem 1.1rem;
  border-radius: var(--site-radius);
  background: var(--site-accent);
  color: var(--site-accent-ink);
  box-shadow: var(--site-shadow);
  display: flex;
  flex-direction: column;
  max-width: 60%;
}
.cse__metric strong {
  font-family: var(--site-display);
  font-size: 1.6rem;
  line-height: 1;
}
.cse__metric span {
  font-size: 0.72rem;
  opacity: 0.9;
}
.cse__client {
  margin: 0 0 0.3rem;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.13em;
  color: var(--site-accent);
  font-weight: 700;
}
.cse__row {
  display: flex;
  gap: 0.8rem;
  margin-top: 1rem;
}
.cse__row span {
  flex: none;
  font-family: var(--site-display);
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--site-ink-soft);
  padding-top: 0.15rem;
}
.cse__row p {
  margin: 0;
  line-height: 1.55;
  color: color-mix(in srgb, var(--site-ink) 84%, var(--site-bg));
}

/* ============ SPLIT CTA ============ */
.s--splitCta .s__h {
  text-align: center;
}
.scta {
  display: grid;
  gap: 1rem;
  max-width: 980px;
  margin: 1.4rem auto 0;
  /* any item count wraps into an even grid; `stack` variant forces one column */
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
}
.s--splitCta--stacked .scta {
  grid-template-columns: 1fr;
  max-width: 620px;
}
.scta__c {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.6rem;
  padding: clamp(1.4rem, 3.5vw, 2.2rem);
  border-radius: var(--site-radius);
  background: var(--site-surface);
  border: 1px solid var(--site-border);
}
.scta__c h3 {
  margin: 0;
  font-size: 1.2rem;
}
.scta__c p {
  margin: 0;
  flex: 1;
  color: var(--site-ink-soft);
  line-height: 1.55;
}
.scta__c .btn {
  margin-top: 0.4rem;
}

/* ============ NEWSLETTER ============ */
.news {
  max-width: 640px;
  margin-inline: auto;
  text-align: center;
}
.s--newsletter--card .news {
  padding: clamp(1.8rem, 5vw, 3rem);
  border-radius: var(--site-radius);
  background: var(--site-surface);
  box-shadow: var(--site-shadow);
}
.news__t {
  margin: 0.4rem 0 1.2rem;
  color: var(--site-ink-soft);
}
.news__form {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  flex-wrap: wrap;
}
.news__form input {
  flex: 1;
  min-width: 220px;
  padding: 0.75rem 1rem;
  border-radius: var(--site-btn-radius);
  border: 1px solid var(--site-border);
  background: var(--site-bg);
  color: var(--site-ink);
  font: inherit;
}
.news__form--preview {
  opacity: 0.7;
}
.news__ok {
  margin: 0.6rem 0 0;
  font-weight: 600;
  color: var(--site-accent);
}
.news__err {
  margin: 0.5rem 0 0;
  font-size: 0.82rem;
  color: #e5484d;
}
.news__n {
  margin: 0.8rem 0 0;
  font-size: 0.78rem;
  color: var(--site-ink-soft);
}

/* ============ BIG QUOTE ============ */
.qb {
  max-width: 820px;
  margin-inline: auto;
  text-align: center;
}
.s--quoteBig--card .qb {
  padding: clamp(2rem, 5vw, 3.5rem);
  border-radius: var(--site-radius);
  background: var(--site-surface);
  box-shadow: var(--site-shadow);
}
.qb__mark {
  display: block;
  font-family: var(--site-display);
  font-size: 3.5rem;
  line-height: 0.6;
  color: var(--site-accent);
}
.qb blockquote {
  margin: 0.6rem 0 1.4rem;
  font-family: var(--site-display);
  font-weight: 500;
  font-size: clamp(1.4rem, 3.6vw, 2.1rem);
  line-height: 1.35;
  letter-spacing: -0.01em;
}
.qb figcaption {
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
}
.qb__av {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  object-fit: cover;
}
.qb figcaption span {
  display: flex;
  flex-direction: column;
  text-align: left;
}
.qb figcaption strong {
  font-weight: 700;
}
.qb figcaption em {
  font-style: normal;
  font-size: 0.85rem;
  color: var(--site-ink-soft);
}

@container (max-width: 700px) {
  .s--caseStudy,
  .ba,
  .scta,
  .tabx__panel:has(.tabx__img) {
    grid-template-columns: 1fr;
  }
  .s--caseStudy--rev .cse__media {
    order: 0;
  }
  .rate {
    flex-direction: column;
    text-align: center;
  }
}

/* ============ modern refinements (token-driven; light + dark) ============ */
.s h2.s__h {
  font-size: clamp(1.7rem, 3.8vw, 2.5rem);
  letter-spacing: -0.025em;
}
.s--hero h1 {
  font-size: clamp(2.3rem, 6vw, 4rem);
  letter-spacing: -0.03em;
  line-height: 1.05;
}
.s--hero__sub,
.s--about__body {
  color: var(--site-ink-soft);
}
/* unify every card surface on the theme tokens */
.card,
.feat,
.tier,
.tm,
.quote,
.pcard,
.srow,
.ccard,
.qa {
  border-color: var(--site-border);
}
.card,
.feat,
.tier,
.tm,
.quote,
.ccard {
  box-shadow: var(--site-shadow);
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    border-color 0.18s ease;
}
.card:hover,
.feat:hover,
.tier:hover,
.tm:hover,
.quote:hover {
  transform: translateY(-4px);
  border-color: color-mix(in srgb, var(--site-accent) 45%, transparent);
  box-shadow: 0 26px 56px -24px color-mix(in srgb, var(--site-accent) 55%, transparent);
}
/* ============ MARQUEE ============ */
.s--mrq {
  overflow: hidden;
}
.mrq {
  overflow: hidden;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent);
}
.mrq__track {
  display: inline-flex;
  gap: 2.4rem;
  padding-right: 2.4rem;
  white-space: nowrap;
  animation: mrq-scroll 26s linear infinite;
}
.s--mrq--slow .mrq__track {
  animation-duration: 42s;
}
.s--mrq--fast .mrq__track {
  animation-duration: 15s;
}
.mrq--static .mrq__track {
  animation: none;
}
.mrq__i {
  font-family: var(--site-display);
  font-weight: 600;
  font-size: clamp(1.1rem, 2.4vw, 1.7rem);
  color: var(--site-ink-soft);
  display: inline-flex;
  align-items: center;
  gap: 2.4rem;
}
.mrq__i::after {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--site-accent);
}
.s--mrq--logos .mrq__i {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: clamp(0.9rem, 1.8vw, 1.15rem);
}
@keyframes mrq-scroll {
  to {
    transform: translateX(-50%);
  }
}

/* ============ BENTO ============ */
.bento {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
}
.bento__c {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 1.4rem;
  border-radius: var(--site-radius);
  border: 1px solid var(--site-border);
  background: var(--site-surface);
  box-shadow: var(--site-shadow);
  min-height: 180px;
}
.s--bento--mixed .bento__c:first-child {
  grid-column: span 2;
  grid-row: span 2;
}
.s--bento--mixed .bento__c:nth-child(4) {
  grid-column: span 2;
}
.bento__img {
  flex: 1;
  min-height: 90px;
  border-radius: calc(var(--site-radius) * 0.6);
  background: var(--site-wash) center / cover no-repeat;
}
.bento__t h3 {
  font-family: var(--site-display);
  font-size: 1.1rem;
  margin: 0 0 0.3rem;
}
.bento__t p {
  margin: 0;
  color: var(--site-ink-soft);
  font-size: 0.92rem;
  white-space: normal;
}
@container (max-width: 720px) {
  .bento {
    grid-template-columns: 1fr 1fr;
  }
  .s--bento--mixed .bento__c:first-child,
  .s--bento--mixed .bento__c:nth-child(4) {
    grid-column: span 2;
    grid-row: auto;
  }
}

/* ============ TIMELINE ============ */
.tl {
  list-style: none;
  margin: 0;
  padding: 0;
  position: relative;
}
.tl::before {
  content: '';
  position: absolute;
  left: 7px;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: var(--site-border);
}
.tl__i {
  position: relative;
  padding: 0 0 1.6rem 2.4rem;
}
.tl__i:last-child {
  padding-bottom: 0;
}
.tl__dot {
  position: absolute;
  left: 0;
  top: 4px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--site-accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--site-accent) 20%, transparent);
}
.tl__date {
  font-family: var(--site-display);
  font-weight: 700;
  color: var(--site-accent);
  font-size: 0.9rem;
}
.tl__t h3 {
  font-family: var(--site-display);
  font-size: 1.15rem;
  margin: 0.15rem 0 0.3rem;
}
.tl__t p {
  margin: 0;
  color: var(--site-ink-soft);
}
@container (min-width: 720px) {
  .s--tl--alternating .tl::before {
    left: 50%;
  }
  .s--tl--alternating .tl__i {
    width: 50%;
    padding-left: 0;
    padding-right: 2.4rem;
    text-align: right;
  }
  .s--tl--alternating .tl__dot {
    left: auto;
    right: -8px;
  }
  .s--tl--alternating .tl__i:nth-child(even) {
    margin-left: 50%;
    padding-left: 2.4rem;
    padding-right: 0;
    text-align: left;
  }
  .s--tl--alternating .tl__i:nth-child(even) .tl__dot {
    left: -8px;
    right: auto;
  }
}

/* ============ COMPARISON ============ */
.cmp {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.95rem;
}
.cmp th,
.cmp td {
  padding: 0.85rem 1rem;
  text-align: center;
  border-bottom: 1px solid var(--site-border);
}
.cmp thead th {
  font-family: var(--site-display);
  font-size: 1rem;
  color: var(--site-ink);
}
.cmp__lbl {
  text-align: left;
  color: var(--site-ink-soft);
}
.cmp .cmp__us {
  background: var(--site-wash);
  font-weight: 600;
}
.cmp__y {
  color: var(--site-accent);
  font-weight: 700;
}
.cmp__n {
  color: color-mix(in srgb, var(--site-ink) 34%, var(--site-bg));
}

/* ============ BANNER ============ */
.s--banner {
  padding-top: 0;
  padding-bottom: 0;
}
.banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
  padding: 1.15rem clamp(1.2rem, 4vw, 2.4rem);
  border-radius: var(--site-radius);
  background: var(--site-wash);
  border: 1px solid var(--site-border);
  color: var(--site-ink);
}
.banner p {
  color: var(--site-ink);
}
.s--banner--gradient .banner {
  background: linear-gradient(
    100deg,
    var(--site-accent),
    color-mix(in srgb, var(--site-accent) 55%, #0b0b12)
  );
  border: 0;
}
.s--banner--gradient .banner p {
  color: var(--site-accent-ink);
}
.banner p {
  margin: 0;
  font-family: var(--site-display);
  font-weight: 600;
  font-size: clamp(1rem, 2.2vw, 1.25rem);
}

/* ============ new variants on existing sections ============ */
.s--hero--gradient {
  background: linear-gradient(
    160deg,
    color-mix(in srgb, var(--site-accent) 22%, var(--site-bg)),
    var(--site-bg)
  );
}
.s--stats--cards .stats,
.s--stats--inline .stats {
  gap: 1rem;
}
.s--stats--cards .stat {
  padding: 1.4rem;
  border-radius: var(--site-radius);
  border: 1px solid var(--site-border);
  background: var(--site-surface);
  box-shadow: var(--site-shadow);
  backdrop-filter: none;
}
/* `cards` / `plain` drop the dark numbers-band, so the value gradient + label
   must read as ink-on-light (the band variants keep the white-on-dark set). */
.s--stats--cards,
.s--stats--plain {
  color: var(--site-ink);
  background: linear-gradient(180deg, var(--site-bg), var(--site-wash));
}
.s--stats--cards::before,
.s--stats--plain::before {
  display: none;
}
.s--stats--cards h2.s__h,
.s--stats--plain h2.s__h {
  color: var(--site-ink);
}
.s--stats--cards .stat__v,
.s--stats--plain .stat__v {
  background: linear-gradient(
    180deg,
    var(--site-ink),
    color-mix(in srgb, var(--site-accent) 62%, var(--site-ink))
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.s--stats--cards .stat__l,
.s--stats--plain .stat__l {
  color: color-mix(in srgb, var(--site-ink) 62%, var(--site-bg));
}
.s--stats--plain .stat {
  background: transparent;
  border-color: transparent;
  backdrop-filter: none;
}
.s--stats--inline .stats {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 2.5rem;
}
.s--services--numbered .card {
  counter-increment: svc;
  position: relative;
}
.s--services--numbered .card::before {
  content: counter(svc, decimal-leading-zero);
  font-family: var(--site-display);
  font-weight: 700;
  font-size: 0.85rem;
  color: var(--site-accent);
}
.s--services--rows .grid,
.s--services--rows .cards {
  display: flex;
  flex-direction: column;
}
.s--feats--checklist .feats {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.s--feats--checklist .feat {
  display: flex;
  gap: 0.7rem;
  align-items: flex-start;
  border: 0;
  box-shadow: none;
  padding: 0.4rem 0;
}
.s--feats--checklist .feat::before {
  content: '✓';
  color: var(--site-accent);
  font-weight: 700;
}
.s--gallery--carousel .grid,
.s--gallery--carousel .ggrid {
  display: flex;
  gap: 1rem;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
}
.s--gallery--carousel .gcell,
.s--gallery--carousel .grid > * {
  flex: 0 0 min(78%, 420px);
  scroll-snap-align: center;
}
.s--quotes--single .quotes,
.s--quotes--single .qgrid {
  max-width: 760px;
  margin-inline: auto;
}
.s--quotes--single .quote {
  text-align: center;
  font-size: 1.15rem;
  border: 0;
  box-shadow: none;
  background: transparent;
}
.s--team--row .team,
.s--team--row .tgrid {
  display: flex;
  flex-wrap: wrap;
  gap: 1.4rem;
}
.s--team--row .tm {
  flex-direction: row;
  align-items: center;
  gap: 1rem;
}
/* `boxed` swaps the full-bleed dark band for a light inset panel — so the
   text has to flip from white to ink, and the glow has to go. */
.s--cta--boxed {
  padding-inline: var(--pad);
  color: var(--site-ink);
  background: var(--site-bg);
}
.s--cta--boxed .s--cta__glow {
  display: none;
}
.s--cta--boxed .s__h {
  color: var(--site-ink);
}
.s--cta--boxed .s__h::after {
  background: linear-gradient(90deg, transparent, var(--site-accent), transparent);
}
.s--cta--boxed .s--cta__btn {
  background: var(--site-accent);
  color: var(--site-accent-ink);
}
.s--cta--boxed .s__h,
.s--cta--boxed .s--cta__btn {
  position: relative;
  z-index: 1;
}
.s--cta--boxed::after {
  content: '';
  position: absolute;
  inset: var(--pad);
  border-radius: var(--site-radius);
  border: 1px solid var(--site-border);
  background: var(--site-wash);
}
.s--faq--plain .qa {
  border: 0;
  border-bottom: 1px solid var(--site-border);
  border-radius: 0;
  box-shadow: none;
  background: transparent;
}
.s--pricing--table .tiers,
.s--pricing--table .pgrid {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.s--pricing--table .tier {
  flex-direction: row;
  align-items: center;
  gap: 1.2rem;
  border-radius: 0;
  border-bottom: 1px solid var(--site-border);
}

/* dark mode: lift image/gradient placeholders + soften scrims */
.site--dark .pcard__ph,
.site--dark .fsrow__ph {
  opacity: 0.4;
}
.site--dark .s--hero {
  background: linear-gradient(180deg, var(--site-wash), var(--site-bg));
}
.site--dark .s--hero--gradient {
  background: linear-gradient(
    160deg,
    color-mix(in srgb, var(--site-accent) 26%, var(--site-bg)),
    var(--site-bg)
  );
}
.site--dark .bento__c,
.site--dark .s--stats--cards .stat {
  background: color-mix(in srgb, var(--site-ink) 5%, var(--site-bg));
}

@media (prefers-reduced-motion: reduce) {
  .site__scroll {
    scroll-behavior: auto;
  }
  .site__scroll--anim .s,
  .site__scroll--anim .s * {
    opacity: 1 !important;
    transform: none !important;
    filter: none !important;
    transition: none !important;
    transition-delay: 0s !important;
  }
  .site__prog {
    transition: none;
  }
  .s--hero__aura,
  .s--hero__cue,
  .s--stats::before,
  .mrq__track {
    animation: none !important;
  }
}
</style>
