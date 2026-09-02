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
}>()

const emit = defineEmits<{ (e: 'lead-sent'): void; (e: 'call'): void }>()

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

const PALETTES: Record<WebsiteTheme['palette'], { accent: string; ink: string; wash: string }> = {
  indigo: { accent: '#4f46e5', ink: '#1e1b4b', wash: '#eef2ff' },
  emerald: { accent: '#059669', ink: '#064e3b', wash: '#ecfdf5' },
  amber: { accent: '#d97706', ink: '#451a03', wash: '#fffbeb' },
  slate: { accent: '#475569', ink: '#0f172a', wash: '#f1f5f9' },
  rose: { accent: '#e11d48', ink: '#4c0519', wash: '#fff1f2' },
}
const RADII: Record<WebsiteTheme['radius'], string> = {
  sharp: '4px',
  soft: '14px',
  round: '26px',
}
const FONTS: Record<WebsiteTheme['fontPair'], { display: string; body: string }> = {
  'grotesk-inter': {
    display: "'Space Grotesk Variable', 'Space Grotesk', sans-serif",
    body: "'Inter Variable', 'Inter', sans-serif",
  },
  'serif-sans': { display: "Georgia, 'Times New Roman', serif", body: "'Inter Variable', sans-serif" },
  'mono-sans': {
    display: "'JetBrains Mono', ui-monospace, monospace",
    body: "'Inter Variable', sans-serif",
  },
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

const DENSITY: Record<WebsiteTheme['density'], string> = {
  compact: '0.82',
  comfortable: '1',
  spacious: '1.25',
}

const styleVars = computed(() => {
  const p = PALETTES[props.theme.palette] ?? PALETTES.indigo
  const f = FONTS[props.theme.fontPair] ?? FONTS['grotesk-inter']
  // A custom brand colour (Simple-site builder) overrides the named palette;
  // ink + wash are derived from it so the whole page stays coherent.
  const custom = props.theme.accent && HEX_RE.test(props.theme.accent) ? props.theme.accent : null
  return {
    '--site-accent': custom ?? p.accent,
    '--site-ink': custom ? `color-mix(in srgb, ${custom} 60%, #0b0b12)` : p.ink,
    '--site-wash': custom ? `color-mix(in srgb, ${custom} 12%, #ffffff)` : p.wash,
    '--site-radius': RADII[props.theme.radius] ?? RADII.soft,
    '--site-display': f.display,
    '--site-body': f.body,
    '--site-density': DENSITY[props.theme.density] ?? '1',
  } as Record<string, string>
})

const pages = computed(() => props.content.pages ?? [])
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

// --- one-page anchor navbar -------------------------------------------
const singlePage = computed(() => pages.value.length <= 1)
const brandName = computed(() => page.value?.title || props.content.seo.title || '')
const NAV_TYPES = ['about', 'services', 'features', 'gallery', 'testimonials', 'faq', 'contact']
const anchors = computed(() =>
  singlePage.value
    ? sections.value
        .filter((s) => NAV_TYPES.includes(s.type))
        .map((s) => ({ id: s.id, label: f(s, 'title') || s.type }))
    : [],
)

const scrollEl = ref<HTMLElement | null>(null)
const navOpen = ref(false)

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

// --- reveal-on-scroll ----------------------------------------------------
// Decided synchronously so sections render hidden from the first paint (no
// flash of content that then hides). The observer just reveals them.
const animate =
  typeof window === 'undefined' ||
  !(
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
    typeof IntersectionObserver === 'undefined'
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

function setupObserver(): void {
  teardownObserver()
  const root = scrollEl.value
  if (!animate || !root || typeof IntersectionObserver === 'undefined') {
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

onMounted(() => void nextTick(setupObserver))
onBeforeUnmount(teardownObserver)

// Studio live-edits swap the section tree — re-arm the observer on the new nodes.
watch(
  () => sections.value.map((s) => s.id).join('|'),
  () => void nextTick(setupObserver),
)
</script>

<template>
  <div class="site" :class="{ 'site--framed': framed }" :style="styleVars">
    <div v-if="framed" class="site__chrome">
      <span /><span /><span />
      <div class="site__url">{{ content.seo.title }}</div>
    </div>

    <nav v-if="pages.length > 1" class="site__nav">
      <button
        v-for="p in pages"
        :key="p.slug"
        type="button"
        :class="{ 'is-on': p.slug === activeSlug }"
        @click="activeSlug = p.slug"
      >
        {{ p.title }}
      </button>
    </nav>

    <div ref="scrollEl" class="site__scroll" :class="{ 'site__scroll--anim': animate }">
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
      </header>

      <template v-for="s in sections" :key="s.id">
        <!-- HERO / LANDING -->
        <section
          v-if="s.type === 'hero'"
          :id="s.id"
          class="s s--hero"
          :class="{
            's--hero--photo': !!f(s, 'backgroundImage'),
            's--hero--left': f(s, 'align') === 'start',
          }"
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
              <span class="btn btn--solid">{{ f(s, 'primaryCta') }}</span>
              <span v-if="f(s, 'secondaryCta')" class="btn btn--ghost">{{ f(s, 'secondaryCta') }}</span>
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
        <section v-else-if="s.type === 'about'" :id="s.id" class="s s--about">
          <div class="s--about__in">
            <p class="s--about__eyebrow">{{ f(s, 'title') }}</p>
            <p class="s--about__body">{{ f(s, 'body') }}</p>
          </div>
        </section>

        <!-- SERVICES -->
        <section v-else-if="s.type === 'services'" :id="s.id" class="s s--services">
          <h2 class="s__h">{{ f(s, 'title') }}</h2>
          <div v-if="f(s, 'layout') === 'list'" class="slist">
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
        <section v-else-if="s.type === 'features'" :id="s.id" class="s s--feats">
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
        <section v-else-if="s.type === 'gallery'" :id="s.id" class="s s--gallery">
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
        <section v-else-if="s.type === 'testimonials'" :id="s.id" class="s s--quotes">
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
        <section v-else-if="s.type === 'faq'" :id="s.id" class="s s--faq">
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
          </div>

          <!-- Interactive request form (public site only) -->
          <form
            v-if="leadSlug && cState !== 'sent'"
            class="cform"
            @submit.prevent="sendContactForm"
          >
            <p class="cform__lead">{{ t('site.formLead') }}</p>
            <div class="cform__row">
              <input v-model="cf.name" type="text" :placeholder="t('site.fName')" autocomplete="name" />
              <input v-model="cf.email" type="email" :placeholder="t('site.fEmail')" autocomplete="email" />
            </div>
            <input v-model="cf.phone" type="tel" :placeholder="t('site.fPhone')" autocomplete="tel" />
            <textarea v-model="cf.message" rows="3" :placeholder="t('site.fMessage')" required></textarea>
            <p v-if="cState === 'error'" class="cform__err">{{ t('site.formError') }}</p>
            <button type="submit" class="btn btn--solid" :disabled="!cValid || cState === 'busy'">
              {{ cState === 'busy' ? t('site.formSending') : t('site.formSend') }}
            </button>
          </form>
          <p v-else-if="leadSlug" class="cform__ok">
            <span aria-hidden="true">✓</span> {{ t('site.formThanks') }}
          </p>
        </section>

        <!-- CTA -->
        <section v-else-if="s.type === 'cta'" :id="s.id" class="s s--cta">
          <span class="s--cta__glow" aria-hidden="true" />
          <h2 class="s__h">{{ f(s, 'headline') }}</h2>
          <button type="button" class="btn btn--solid s--cta__btn" @click="scrollToId('contact')">
            {{ f(s, 'buttonLabel') }}
          </button>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.site {
  --pad: clamp(1.5rem, 5vw, 4rem);
  container-type: inline-size;
  font-family: var(--site-body);
  color: var(--site-ink);
  background: #fff;
  border-radius: var(--tvz-radius-lg);
  border: 1px solid var(--tvz-hairline);
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

/* legacy multi-page page switcher (advanced sites) */
.site__nav {
  display: flex;
  gap: 0.25rem;
  padding: 0.4rem 0.9rem;
  background: #fff;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  overflow-x: auto;
}
.site__nav button {
  flex: 0 0 auto;
  padding: 0.35rem 0.8rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
  color: #6b7280;
  font-family: var(--site-body);
}
.site__nav button.is-on {
  background: var(--site-accent);
  color: #fff;
}

.site__scroll {
  overflow-y: auto;
  scroll-behavior: smooth;
}
.site--framed .site__scroll {
  max-height: 620px;
}

/* one-page anchor navbar */
.site__bar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.7rem clamp(1rem, 5vw, 3rem);
  background: color-mix(in srgb, #ffffff 82%, transparent);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid color-mix(in srgb, var(--site-ink) 10%, transparent);
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
  color: color-mix(in srgb, var(--site-ink) 62%, #fff);
  font-family: var(--site-body);
  transition:
    color 0.15s ease,
    background 0.15s ease;
}
.site__links button:hover {
  color: #fff;
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
    padding: 0.65rem clamp(1rem, 5vw, 2rem);
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
.s__h {
  font-size: clamp(1.5rem, 3.4vw, 2.15rem);
  /* the accent bar sits just below the text; keep clear air to the content */
  margin-bottom: clamp(2.9rem, 4vw, 3.8rem);
  padding-bottom: 1rem;
  position: relative;
}
.s__h::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: 0;
  width: 44px;
  height: 3px;
  border-radius: 3px;
  background: linear-gradient(90deg, var(--site-accent), transparent);
}

/* scroll-reveal — the hero stays visible (it is above the fold) */
.site__scroll--anim .s:not(.s--hero) {
  opacity: 0;
  transform: translateY(18px);
  transition:
    opacity 0.5s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}
.site__scroll--anim .s:not(.s--hero).is-in {
  opacity: 1;
  transform: none;
}

/* HERO */
.s--hero {
  overflow: hidden;
  background: linear-gradient(180deg, var(--site-wash), #fff);
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
  color: color-mix(in srgb, var(--site-ink) 72%, #fff);
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
  padding: 0.75rem 1.4rem;
  border-radius: var(--site-radius);
  font-weight: 600;
  font-size: 0.95rem;
}
.btn--solid {
  background: var(--site-accent);
  color: #fff;
  box-shadow: 0 10px 24px -12px var(--site-accent);
}
.btn--ghost {
  border: 1px solid color-mix(in srgb, var(--site-ink) 25%, #fff);
}

/* ABOUT */
.s--about {
  text-align: center;
  background: linear-gradient(180deg, #fff, var(--site-wash));
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
  color: color-mix(in srgb, var(--site-ink) 82%, #fff);
}

/* FEATURES / WHY US */
.s--feats {
  background: var(--site-wash);
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
  background: #fff;
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
  color: #fff;
  background: var(--site-accent);
}
.feat strong {
  font-family: var(--site-display);
  font-size: 1rem;
}
.feat p {
  margin: 0.2rem 0 0;
  font-size: 0.88rem;
  color: color-mix(in srgb, var(--site-ink) 60%, #fff);
}

/* SERVICES */
.s--services {
  background: var(--site-wash);
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
  background: #fff;
  border: 1px solid color-mix(in srgb, var(--site-ink) 10%, transparent);
  border-radius: calc(var(--site-radius) + 4px);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
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
  background: color-mix(in srgb, var(--site-accent) 13%, #fff);
  margin-bottom: 0.9rem;
}
.card__n {
  position: absolute;
  top: 1.1rem;
  right: 1.2rem;
  font-family: var(--site-display);
  font-weight: 700;
  font-size: 0.8rem;
  color: color-mix(in srgb, var(--site-ink) 28%, #fff);
  letter-spacing: 0.04em;
}
.card h3 {
  font-size: 1.06rem;
  margin-bottom: 0.4rem;
}
.card p {
  font-size: 0.9rem;
  color: color-mix(in srgb, var(--site-ink) 62%, #fff);
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
  color: #fff;
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
  color: color-mix(in srgb, var(--site-ink) 62%, #fff);
  max-width: 60ch;
}
.srow__n {
  flex: none;
  font-family: var(--site-display);
  font-weight: 700;
  font-size: 1.1rem;
  color: color-mix(in srgb, var(--site-ink) 22%, #fff);
}

/* PORTFOLIO */
.s--gallery {
  background: linear-gradient(180deg, #fff, var(--site-wash));
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
  background: #fff;
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
  color: color-mix(in srgb, var(--site-ink) 60%, #fff);
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
  background: #fff;
  border: 1px solid color-mix(in srgb, var(--site-ink) 10%, transparent);
  border-radius: calc(var(--site-radius) + 6px);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.quote__mark {
  position: absolute;
  top: -0.3rem;
  right: 1rem;
  font-family: var(--site-display);
  font-size: 3.5rem;
  line-height: 1;
  color: color-mix(in srgb, var(--site-accent) 30%, #fff);
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
  color: #fff;
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
  color: color-mix(in srgb, var(--site-ink) 60%, #fff);
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
  background: #fff;
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
  background: color-mix(in srgb, var(--site-accent) 13%, #fff);
  margin-bottom: 0.55rem;
}
.ccard__k {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 700;
  color: color-mix(in srgb, var(--site-ink) 45%, #fff);
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
  background: #fff;
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
  border: 1px solid color-mix(in srgb, var(--site-ink) 22%, #fff);
  border-radius: var(--site-radius);
  font: inherit;
  font-size: 0.92rem;
  background: #fff;
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
.s--cta .s__h {
  position: relative;
  margin-inline: auto;
  font-size: clamp(1.6rem, 4vw, 2.5rem);
  max-width: 24ch;
}
.s--cta .s__h::after {
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(90deg, transparent, #fff, transparent);
}
.s--cta__btn {
  position: relative;
  background: #fff;
  color: var(--site-ink);
  border: 0;
  cursor: pointer;
  box-shadow: 0 12px 30px -12px rgba(0, 0, 0, 0.5);
}

@media (prefers-reduced-motion: reduce) {
  .site__scroll {
    scroll-behavior: auto;
  }
  .site__scroll--anim .s:not(.s--hero) {
    opacity: 1 !important;
    transform: none !important;
    transition: none;
  }
  .s--hero__aura,
  .s--hero__cue {
    animation: none !important;
  }
}
</style>
