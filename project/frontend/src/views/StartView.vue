<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { useSeo } from '@/composables/useSeo'

/**
 * Navbar entry point. Two options with clearly different purposes:
 *  - create a website and get online (the full /create flow, unchanged),
 *  - optimize a Google Ads campaign the visitor already runs (the
 *    optimization builder; it does not create a website).
 * Same card design for both; the illustration, title and one sentence carry
 * the difference.
 */
const { t } = useI18n()
useSeo(() => ({
  title: t('start.seoTitle'),
  description: t('start.seoDesc'),
  canonicalPath: '/start',
}))

const CREATE_TAGS = ['site', 'online', 'campaign'] as const
const OPTIMIZE_TAGS = ['existing', 'improve', 'noSite'] as const
</script>

<template>
  <v-container class="st">
    <header class="st__head">
      <p class="st__eyebrow"><span class="st__dot" /> {{ t('start.eyebrow') }}</p>
      <h1>{{ t('start.title') }}</h1>
      <p class="st__lead">{{ t('start.lead') }}</p>
    </header>

    <div class="st__cards">
      <!-- 1. Create a website & campaign (main option) -->
      <RouterLink :to="{ name: 'create' }" class="card" data-guide="start-scratch">
        <div class="art art--site" aria-hidden="true">
          <div class="win">
            <div class="win__bar"><i /><i /><i /><span class="win__url" /></div>
            <div class="win__hero" />
            <div class="win__row"><span /><span /><span /></div>
          </div>
          <span class="art__badge"><v-icon icon="mdi-web" size="18" /></span>
        </div>

        <div class="card__main">
          <p class="card__kicker">{{ t('start.createKicker') }}</p>
          <h2>{{ t('start.createTitle') }}</h2>
          <p class="card__text">{{ t('start.createText') }}</p>
          <ul class="tags">
            <li v-for="k in CREATE_TAGS" :key="k">{{ t(`start.createTags.${k}`) }}</li>
          </ul>
        </div>
        <span class="card__cta">{{ t('start.createCta') }} <v-icon icon="mdi-arrow-right" size="18" /></span>
      </RouterLink>

      <!-- 2. Optimize an existing Google Ads campaign -->
      <RouterLink :to="{ name: 'ads-connect' }" class="card" data-guide="start-optimize">
        <div class="art art--ads" aria-hidden="true">
          <div class="chart">
            <span style="height: 34%" /><span style="height: 46%" /><span style="height: 42%" />
            <span style="height: 62%" /><span style="height: 78%" /><span style="height: 92%" />
            <v-icon icon="mdi-trending-up" size="26" class="chart__arrow" />
          </div>
          <span class="art__badge"><v-icon icon="mdi-google-ads" size="18" /></span>
        </div>

        <div class="card__main">
          <p class="card__kicker">{{ t('start.optimizeKicker') }}</p>
          <h2>{{ t('start.optimizeTitle') }}</h2>
          <p class="card__text">{{ t('start.optimizeText') }}</p>
          <ul class="tags">
            <li v-for="k in OPTIMIZE_TAGS" :key="k">{{ t(`start.optimizeTags.${k}`) }}</li>
          </ul>
        </div>
        <span class="card__cta">{{ t('start.optimizeCta') }} <v-icon icon="mdi-arrow-right" size="18" /></span>
      </RouterLink>
    </div>
  </v-container>
</template>

<style scoped>
.st {
  max-width: 980px;
  padding-block: clamp(2.5rem, 7vw, 5rem);
}
.st__head {
  text-align: center;
  margin-bottom: 2.5rem;
}
.st__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 1rem;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--tvz-ai);
}
.st__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--tvz-ai);
  box-shadow: 0 0 0 4px var(--tvz-ai-soft);
}
.st__head h1 {
  margin: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(2rem, 5.5vw, 3.2rem);
  letter-spacing: -0.03em;
  line-height: 1.05;
  text-wrap: balance;
}
.st__lead {
  margin: 1rem auto 0;
  max-width: 46ch;
  font-size: 1.05rem;
  color: rgba(var(--v-theme-on-surface), 0.66);
}
.st__cards {
  display: grid;
  gap: 1.5rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: stretch;
}

/* One card design for both options. */
.card {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1rem 1rem 1.4rem;
  border-radius: var(--tvz-radius-lg);
  border: 1px solid var(--tvz-glass-border);
  background: var(--tvz-glass-bg);
  backdrop-filter: blur(var(--tvz-glass-blur));
  -webkit-backdrop-filter: blur(var(--tvz-glass-blur));
  box-shadow: var(--tvz-shadow-sm);
  color: inherit;
  text-decoration: none;
  transition:
    transform var(--tvz-dur-med, 0.25s) var(--tvz-ease-out, ease),
    box-shadow var(--tvz-dur-med, 0.25s) var(--tvz-ease-out, ease),
    border-color var(--tvz-dur-med, 0.25s) var(--tvz-ease-out, ease);
}
.card:hover,
.card:focus-visible {
  transform: translateY(-4px);
  box-shadow: var(--tvz-shadow-lg);
  border-color: rgba(var(--v-theme-primary), 0.45);
}
.card:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 3px;
}
.card__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding-inline: 0.6rem;
}
.card__kicker {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgb(var(--v-theme-primary));
}
.card h2 {
  margin: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.015em;
  line-height: 1.15;
}
.card__text {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.tags {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0.35rem 0 0;
  padding: 0;
}
.tags li {
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  border: 1px solid var(--tvz-hairline);
  font-size: 0.78rem;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.78);
}
.card__cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  margin-inline: 0.6rem;
  padding: 0.8rem 1rem;
  border-radius: 999px;
  font-weight: 600;
  color: #fff;
  background: rgb(var(--v-theme-primary));
  transition: filter 0.15s;
}
.card:hover .card__cta {
  filter: brightness(1.08);
}

/* --- illustrations: same frame, different picture --- */
.art {
  position: relative;
  display: grid;
  place-items: center;
  height: 168px;
  border-radius: calc(var(--tvz-radius-lg) - 6px);
  background:
    radial-gradient(90% 90% at 20% 0%, rgba(var(--v-theme-primary), 0.22), transparent 60%),
    radial-gradient(80% 80% at 100% 100%, rgba(var(--v-theme-primary), 0.12), transparent 60%),
    rgba(var(--v-theme-on-surface), 0.04);
  overflow: hidden;
}
.art__badge {
  position: absolute;
  top: 0.75rem;
  left: 0.75rem;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 11px;
  background: rgb(var(--v-theme-primary));
  color: #fff;
  box-shadow: var(--tvz-glow-primary);
}
/* Website mockup */
.win {
  width: min(62%, 260px);
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgb(var(--v-theme-surface));
  box-shadow: var(--tvz-shadow-lg);
  overflow: hidden;
  transform: translateY(10px);
}
.win__bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.win__bar i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), 0.2);
}
.win__url {
  flex: 1;
  height: 7px;
  margin-left: 6px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.win__hero {
  height: 46px;
  margin: 8px;
  border-radius: 6px;
  background: linear-gradient(120deg, rgba(var(--v-theme-primary), 0.55), rgba(var(--v-theme-primary), 0.15));
}
.win__row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: 0 8px 10px;
}
.win__row span {
  height: 22px;
  border-radius: 5px;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
/* Rising chart */
.chart {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  width: min(58%, 240px);
  height: 104px;
  padding: 10px 12px 0;
  border-bottom: 2px solid rgba(var(--v-theme-on-surface), 0.16);
  transform: translateY(10px);
}
.chart span {
  flex: 1;
  border-radius: 5px 5px 0 0;
  background: linear-gradient(180deg, rgba(var(--v-theme-primary), 0.85), rgba(var(--v-theme-primary), 0.3));
}
.chart span:nth-child(-n + 3) {
  background: rgba(var(--v-theme-on-surface), 0.16);
}
.chart__arrow {
  position: absolute;
  top: -14px;
  right: -6px;
  color: rgb(var(--v-theme-success));
}

@media (max-width: 760px) {
  .st__cards {
    grid-template-columns: minmax(0, 1fr);
  }
  .art {
    height: 140px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .card,
  .card:hover {
    transition: none;
    transform: none;
  }
}
</style>
