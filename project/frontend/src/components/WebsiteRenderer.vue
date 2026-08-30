<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { submitLead, trackCall } from '@/services/leads'
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

const styleVars = computed(() => {
  const p = PALETTES[props.theme.palette] ?? PALETTES.indigo
  const f = FONTS[props.theme.fontPair] ?? FONTS['grotesk-inter']
  return {
    '--site-accent': p.accent,
    '--site-ink': p.ink,
    '--site-wash': p.wash,
    '--site-radius': RADII[props.theme.radius] ?? RADII.soft,
    '--site-display': f.display,
    '--site-body': f.body,
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

    <div class="site__scroll">
      <template v-for="s in sections" :key="s.id">
        <!-- HERO -->
        <section v-if="s.type === 'hero'" class="s s--hero">
          <p class="s--hero__eyebrow">{{ page?.title }}</p>
          <h1>{{ f(s, 'headline') }}</h1>
          <p class="s--hero__sub">{{ f(s, 'subheadline') }}</p>
          <div class="s--hero__cta">
            <span class="btn btn--solid">{{ f(s, 'primaryCta') }}</span>
            <span v-if="f(s, 'secondaryCta')" class="btn btn--ghost">{{ f(s, 'secondaryCta') }}</span>
          </div>
        </section>

        <!-- ABOUT -->
        <section v-else-if="s.type === 'about'" class="s s--about">
          <h2>{{ f(s, 'title') }}</h2>
          <p>{{ f(s, 'body') }}</p>
        </section>

        <!-- SERVICES -->
        <section v-else-if="s.type === 'services'" class="s s--services">
          <h2>{{ f(s, 'title') }}</h2>
          <div class="grid">
            <div v-for="(item, i) in f(s, 'items')" :key="i" class="tile">
              <h3>{{ item.name }}</h3>
              <p>{{ item.description }}</p>
            </div>
          </div>
        </section>

        <!-- GALLERY / PORTFOLIO -->
        <section v-else-if="s.type === 'gallery'" class="s s--gallery">
          <h2>{{ f(s, 'title') }}</h2>
          <div class="grid grid--2">
            <div v-for="(item, i) in f(s, 'items')" :key="i" class="tile">
              <div class="tile__shot" aria-hidden="true" />
              <h3>{{ item.title }}</h3>
              <p v-if="item.description">{{ item.description }}</p>
            </div>
          </div>
        </section>

        <!-- TESTIMONIALS -->
        <section v-else-if="s.type === 'testimonials'" class="s s--quotes">
          <h2>{{ f(s, 'title') }}</h2>
          <div class="grid grid--2">
            <blockquote v-for="(item, i) in f(s, 'items')" :key="i">
              <p>“{{ item.quote }}”</p>
              <cite>— {{ item.author }}</cite>
            </blockquote>
          </div>
        </section>

        <!-- FAQ -->
        <section v-else-if="s.type === 'faq'" class="s s--faq">
          <h2>{{ f(s, 'title') }}</h2>
          <div v-for="(item, i) in f(s, 'items')" :key="i" class="qa">
            <h3>{{ item.q }}</h3>
            <p>{{ item.a }}</p>
          </div>
        </section>

        <!-- CONTACT -->
        <section v-else-if="s.type === 'contact'" class="s s--contact">
          <h2>{{ f(s, 'title') }}</h2>
          <ul>
            <li v-if="f(s, 'phone')">
              <strong>{{ t('site.phone') }}</strong>
              <a v-if="leadSlug" :href="`tel:${f(s, 'phone')}`" @click="onCall">{{ f(s, 'phone') }}</a>
              <template v-else>{{ f(s, 'phone') }}</template>
            </li>
            <li v-if="f(s, 'email')"><strong>{{ t('site.email') }}</strong> {{ f(s, 'email') }}</li>
            <li v-if="f(s, 'city')"><strong>{{ t('site.area') }}</strong> {{ f(s, 'city') }}</li>
          </ul>

          <!-- Interactive request form (public site only) -->
          <form v-if="leadSlug && cState !== 'sent'" class="cform" @submit.prevent="sendContactForm">
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
        <section v-else-if="s.type === 'cta'" class="s s--cta">
          <h2>{{ f(s, 'headline') }}</h2>
          <span class="btn btn--solid">{{ f(s, 'buttonLabel') }}</span>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.site {
  --pad: clamp(1.5rem, 5vw, 4rem);
  font-family: var(--site-body);
  color: var(--site-ink);
  background: #fff;
  border-radius: var(--tvz-radius-lg);
  overflow: hidden;
  border: 1px solid var(--tvz-hairline);
}
.site--framed {
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
}
.site--framed .site__scroll {
  max-height: 620px;
}

.s--gallery {
  background: var(--site-wash);
}
.s--gallery h2 {
  font-size: clamp(1.4rem, 3vw, 2rem);
  margin-bottom: 1.6rem;
}
.tile__shot {
  height: 120px;
  border-radius: var(--site-radius);
  margin-bottom: 0.8rem;
  background: linear-gradient(135deg, var(--site-wash), var(--site-accent));
  opacity: 0.5;
}

.s {
  padding: clamp(2.5rem, 7vw, 5rem) var(--pad);
}
.s h1,
.s h2,
.s h3 {
  font-family: var(--site-display);
  letter-spacing: -0.02em;
  line-height: 1.1;
  margin: 0;
}
.s p {
  line-height: 1.65;
}

.s--hero {
  background: linear-gradient(180deg, var(--site-wash), #fff);
  text-align: center;
}
.s--hero__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 12px;
  color: var(--site-accent);
  font-weight: 600;
  margin: 0 0 1rem;
}
.s--hero h1 {
  font-size: clamp(1.9rem, 5vw, 3.2rem);
  max-width: 22ch;
  margin-inline: auto;
}
.s--hero__sub {
  max-width: 56ch;
  margin: 1.2rem auto 1.8rem;
  color: color-mix(in srgb, var(--site-ink) 72%, #fff);
  font-size: 1.05rem;
}
.s--hero__cta {
  display: flex;
  gap: 0.8rem;
  justify-content: center;
  flex-wrap: wrap;
}

.btn {
  display: inline-flex;
  align-items: center;
  padding: 0.7rem 1.3rem;
  border-radius: var(--site-radius);
  font-weight: 600;
  font-size: 0.95rem;
}
.btn--solid {
  background: var(--site-accent);
  color: #fff;
}
.btn--ghost {
  border: 1px solid color-mix(in srgb, var(--site-ink) 25%, #fff);
}

.s--about {
  max-width: 62ch;
}
.s--about h2 {
  font-size: clamp(1.4rem, 3vw, 2rem);
  margin-bottom: 1rem;
}

.s--services {
  background: var(--site-wash);
}
.s--services h2,
.s--quotes h2,
.s--faq h2 {
  font-size: clamp(1.4rem, 3vw, 2rem);
  margin-bottom: 1.6rem;
}
.grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}
.grid--2 {
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}
.tile {
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: var(--site-radius);
  padding: 1.3rem;
}
.tile h3 {
  font-size: 1.05rem;
  margin-bottom: 0.4rem;
}
.tile p {
  font-size: 0.9rem;
  color: #555;
}

blockquote {
  margin: 0;
  background: var(--site-wash);
  border-radius: var(--site-radius);
  padding: 1.4rem;
}
blockquote cite {
  display: block;
  margin-top: 0.8rem;
  font-size: 0.85rem;
  color: #666;
  font-style: normal;
}

.qa {
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  padding: 1.1rem 0;
}
.qa h3 {
  font-size: 1rem;
  margin-bottom: 0.35rem;
}
.qa p {
  color: #555;
  font-size: 0.92rem;
}

.s--contact ul {
  list-style: none;
  padding: 0;
  margin: 1rem 0 0;
  display: grid;
  gap: 0.5rem;
}
.s--contact strong {
  display: inline-block;
  min-width: 5rem;
  color: var(--site-accent);
}
.s--contact a {
  color: var(--site-accent);
  font-weight: 600;
}

.cform {
  margin-top: 1.6rem;
  max-width: 34rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
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

.s--cta {
  background: var(--site-ink);
  color: #fff;
  text-align: center;
}
.s--cta h2 {
  font-size: clamp(1.4rem, 3vw, 2rem);
  margin-bottom: 1.4rem;
}
</style>
