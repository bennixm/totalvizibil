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
  /** Advanced builder: id of the section drawn with a selection outline. */
  selectedId?: string | null
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
/** Pages shown in the multi-page top nav (Advanced builder honours `nav`). */
const navPages = computed(() => pages.value.filter((p) => (p as { nav?: boolean }).nav !== false))
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
    <div v-if="framed" class="site__chrome">
      <span /><span /><span />
      <div class="site__url">{{ content.seo.title }}</div>
    </div>

    <nav
      v-if="navPages.length > 1"
      class="site__nav"
      :class="{ 'site__nav--open': navOpen }"
    >
      <span class="site__nav-brand">{{ brandName }}</span>
      <button
        type="button"
        class="site__nav-burger"
        :aria-expanded="navOpen"
        aria-label="Menu"
        @click="navOpen = !navOpen"
      >
        <v-icon :icon="navOpen ? 'mdi-close' : 'mdi-menu'" size="20" />
      </button>
      <div class="site__nav-links">
        <button
          v-for="p in navPages"
          :key="p.slug"
          type="button"
          :class="{ 'is-on': p.slug === activeSlug }"
          @click="activeSlug = p.slug; navOpen = false"
        >
          {{ p.title }}
        </button>
      </div>
    </nav>

    <div
      ref="scrollEl"
      class="site__scroll"
      :class="{ 'site__scroll--anim': animate, 'site__scroll--edit': editable }"
      @click="onScrollClick"
    >
      <!-- one-page anchor navbar -->
      <header
        v-if="singlePage"
        class="site__bar"
        :class="{ 'site__bar--open': navOpen }"
      >
        <span class="site__brand">{{ brandName }}</span>
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
                  backgroundImage: `linear-gradient(180deg, rgba(8,10,20,0.34), rgba(8,10,20,0.66)), url(${f(s, 'backgroundImage')})`,
                }
              : undefined
          "
        >
          <span v-if="!f(s, 'backgroundImage')" class="s--hero__aura" aria-hidden="true" />
          <div class="s--hero__in">
            <p class="s--hero__eyebrow">{{ page?.title }}</p>
            <h1>{{ f(s, 'headline') }}</h1>
            <p v-if="f(s, 'subheadline')" class="s--hero__sub">{{ f(s, 'subheadline') }}</p>
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
            <p class="s--about__eyebrow">{{ f(s, 'title') }}</p>
            <p class="s--about__body">{{ f(s, 'body') }}</p>
          </div>
          <div v-if="f(s, 'imageUrl')" class="s--about__img">
            <img :src="f(s, 'imageUrl')" alt="" loading="lazy" />
          </div>
        </section>

        <!-- STATS / NUMBERS BAND -->
        <section v-else-if="s.type === 'stats'" :id="s.id" class="s s--stats" :class="vclass(s)">
          <h2 v-if="f(s, 'title')" class="s__h">{{ f(s, 'title') }}</h2>
          <div class="stats">
            <div v-for="(item, i) in f(s, 'items')" :key="i" class="stat">
              <span class="stat__v">{{ item.value }}</span>
              <span class="stat__l">{{ item.label }}</span>
            </div>
          </div>
        </section>

        <!-- PROCESS / HOW WE WORK -->
        <section v-else-if="s.type === 'process'" :id="s.id" class="s s--process">
          <h2 class="s__h">{{ f(s, 'title') }}</h2>
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
          <h2 class="s__h">{{ f(s, 'title') }}</h2>
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
          <h2 class="s__h">{{ f(s, 'title') }}</h2>
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
          <h2 class="s__h">{{ f(s, 'title') }}</h2>
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
          <h2 class="s__h">{{ f(s, 'title') }}</h2>
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
          <h2 class="s__h">{{ f(s, 'title') }}</h2>
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
          <h2 class="s__h">{{ f(s, 'title') }}</h2>

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
          <h2 v-if="f(s, 'title')" class="s__h">{{ f(s, 'title') }}</h2>
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
          <h2 class="s__h">{{ f(s, 'title') }}</h2>
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
          <h2 class="s__h">{{ f(s, 'title') }}</h2>
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
          <h2 v-if="f(s, 'title')" class="s__h">{{ f(s, 'title') }}</h2>
          <div class="rich">
            <p v-for="(para, i) in String(f(s, 'body') || '').split(/\n{2,}/)" :key="i">{{ para }}</p>
          </div>
        </section>

        <!-- CTA -->
        <section v-else-if="s.type === 'cta'" :id="s.id" class="s s--cta" :class="vclass(s)">
          <span class="s--cta__glow" aria-hidden="true" />
          <h2 class="s__h">{{ f(s, 'headline') }}</h2>
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
          <h2 v-if="f(s, 'title')" class="s__h">{{ f(s, 'title') }}</h2>
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
          <h2 v-if="f(s, 'title')" class="s__h">{{ f(s, 'title') }}</h2>
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
          <h2 v-if="f(s, 'title')" class="s__h">{{ f(s, 'title') }}</h2>
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
      </template>

      <footer class="site__foot">
        <div class="site__foot-in">
          <div class="site__foot-col site__foot-col--brand">
            <span class="site__foot-brand">{{ brandName }}</span>
            <p v-if="footBlurb" class="site__foot-blurb">{{ footBlurb }}</p>
          </div>
          <nav v-if="footLinks.length" class="site__foot-col">
            <span class="site__foot-h">{{ t('site.footExplore') }}</span>
            <button
              v-for="l in footLinks"
              :key="l.key"
              type="button"
              @click="l.go()"
            >
              {{ l.label }}
            </button>
          </nav>
          <div v-if="footContact" class="site__foot-col">
            <span class="site__foot-h">{{ t('site.footContact') }}</span>
            <span v-if="footContact.phone">{{ footContact.phone }}</span>
            <span v-if="footContact.email">{{ footContact.email }}</span>
            <span v-if="footContact.city">{{ footContact.city }}</span>
          </div>
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
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem clamp(1rem, 4vw, 2.4rem);
  background: color-mix(in srgb, var(--site-bg) 82%, transparent);
  backdrop-filter: blur(14px) saturate(1.3);
  border-bottom: 1px solid var(--site-border);
}
.site__nav-brand {
  display: none;
  font-family: var(--site-display);
  font-weight: 700;
  font-size: 1rem;
  color: var(--site-ink);
  flex: 1;
  min-width: 0;
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
  gap: 0.15rem;
  overflow-x: auto;
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
    display: block;
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
    gap: 0;
    overflow: hidden;
    max-height: 0;
    transition: max-height 0.28s ease;
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
  color: #fff;
  padding-block: clamp(4.5rem, 13vw, 9rem);
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
  background: color-mix(in srgb, var(--site-accent) 10%, #0b0c11);
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.88rem;
}
.site__foot-in {
  display: grid;
  grid-template-columns: 1.6fr 1fr 1fr;
  gap: clamp(1.5rem, 5vw, 3.5rem);
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
.s--cta--boxed {
  padding-inline: var(--pad);
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
