<script setup lang="ts">
import { computed } from 'vue'

import type { Section, WebsiteContent, WebsiteTheme } from '@/stores/draft'

const props = defineProps<{
  content: WebsiteContent
  theme: WebsiteTheme
  /** Render inside a scaled "browser frame" preview shell. */
  framed?: boolean
}>()

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

const page = computed(() => props.content.pages.find((p) => p.isHome) ?? props.content.pages[0])
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
            <li v-if="f(s, 'phone')"><strong>Phone</strong> {{ f(s, 'phone') }}</li>
            <li v-if="f(s, 'email')"><strong>Email</strong> {{ f(s, 'email') }}</li>
            <li v-if="f(s, 'city')"><strong>Area</strong> {{ f(s, 'city') }}</li>
          </ul>
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
.site__scroll {
  overflow-y: auto;
}
.site--framed .site__scroll {
  max-height: 620px;
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
