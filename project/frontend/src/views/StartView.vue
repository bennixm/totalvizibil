<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useSeo } from '@/composables/useSeo'

/**
 * Navbar entry point: choose between building a business from scratch (the
 * existing /create flow, untouched) and optimizing a Google Ads campaign the
 * visitor already runs (the Google Ads optimization builder).
 */
const { t } = useI18n()
useSeo(() => ({
  title: t('start.seoTitle'),
  description: t('start.seoDesc'),
  canonicalPath: '/start',
}))

const SCRATCH = ['site', 'feed', 'campaign'] as const
const OPTIMIZE = ['connect', 'agent', 'approve'] as const
</script>

<template>
  <v-container class="st">
    <header class="st__head">
      <p class="st__eyebrow"><span class="st__dot" /> {{ t('start.eyebrow') }}</p>
      <h1>{{ t('start.title') }}</h1>
      <p class="st__lead">{{ t('start.lead') }}</p>
    </header>

    <div class="st__cards">
      <RouterLink :to="{ name: 'create' }" class="opt" data-guide="start-scratch">
        <span class="opt__icon"><v-icon icon="mdi-rocket-launch-outline" size="24" /></span>
        <h2>{{ t('start.scratchTitle') }}</h2>
        <p class="opt__text">{{ t('start.scratchText') }}</p>
        <ul class="opt__list">
          <li v-for="k in SCRATCH" :key="k">
            <v-icon icon="mdi-check-circle" size="16" /> {{ t(`start.scratch.${k}`) }}
          </li>
        </ul>
        <span class="opt__cta">
          {{ t('start.scratchCta') }} <v-icon icon="mdi-arrow-right" size="18" />
        </span>
      </RouterLink>

      <RouterLink :to="{ name: 'ads-connect' }" class="opt opt--ads" data-guide="start-optimize">
        <span class="opt__badge"><v-icon icon="mdi-google-ads" size="13" /> Google Ads</span>
        <span class="opt__icon opt__icon--ads"><v-icon icon="mdi-chart-timeline-variant-shimmer" size="24" /></span>
        <h2>{{ t('start.optimizeTitle') }}</h2>
        <p class="opt__text">{{ t('start.optimizeText') }}</p>
        <ul class="opt__list">
          <li v-for="k in OPTIMIZE" :key="k">
            <v-icon icon="mdi-check-circle" size="16" /> {{ t(`start.optimize.${k}`) }}
          </li>
        </ul>
        <p class="opt__free"><v-icon icon="mdi-gift-outline" size="15" /> {{ t('start.optimizeFree') }}</p>
        <span class="opt__cta">
          {{ t('start.optimizeCta') }} <v-icon icon="mdi-arrow-right" size="18" />
        </span>
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
  margin-bottom: 2.75rem;
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
  max-width: 50ch;
  font-size: 1.05rem;
  color: rgba(var(--v-theme-on-surface), 0.66);
}
.st__cards {
  display: grid;
  gap: 1.5rem;
  grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
  align-items: stretch;
}
.opt {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 2rem 1.9rem 1.8rem;
  border-radius: var(--tvz-radius-lg);
  border: 1px solid var(--tvz-glass-border);
  background: linear-gradient(180deg, rgba(var(--v-theme-on-surface), 0.08), var(--tvz-glass-bg) 65%);
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
.opt:hover,
.opt:focus-visible {
  transform: translateY(-4px);
  box-shadow: var(--tvz-shadow-lg);
  border-color: rgba(var(--v-theme-primary), 0.45);
}
.opt--ads {
  border-color: rgba(var(--v-theme-primary), 0.3);
  background: linear-gradient(180deg, rgba(var(--v-theme-primary), 0.06), var(--tvz-glass-bg) 55%);
}
.opt__badge {
  position: absolute;
  top: -12px;
  left: 50%;
  translate: -50% 0;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.28rem 0.8rem;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #fff;
  background: var(--tvz-gradient-brand);
  box-shadow: var(--tvz-glow-primary);
}
.opt__icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgb(var(--v-theme-on-surface));
}
.opt__icon--ads {
  background: var(--tvz-ai-soft);
  color: var(--tvz-ai);
}
.opt h2 {
  margin: 0.2rem 0 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.4rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.opt__text {
  margin: 0;
  font-size: 0.93rem;
  line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.68);
}
.opt__list {
  list-style: none;
  margin: 0.3rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex: 1;
}
.opt__list li {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.88rem;
  line-height: 1.4;
}
.opt__list .v-icon {
  flex: none;
  margin-top: 0.1rem;
  color: rgb(var(--v-theme-primary));
}
.opt__free {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-size: 0.84rem;
  font-weight: 600;
  color: rgb(var(--v-theme-success));
}
.opt__cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  margin-top: 0.4rem;
  padding: 0.75rem 1rem;
  border-radius: 999px;
  font-weight: 600;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.opt--ads .opt__cta {
  color: #fff;
  background: rgb(var(--v-theme-primary));
}
</style>
