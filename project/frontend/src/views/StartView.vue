<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useSeo } from '@/composables/useSeo'
import { googleAdsUserApi } from '@/services/googleAdsUser'

/**
 * Navbar entry point: build from scratch (the full /create flow, untouched)
 * or optimize a Google Ads campaign the visitor already runs (the Google Ads
 * optimization builder). Both cards share one design; the difference is in
 * the content: the create card walks through the complete process, the
 * optimize card lists only what the optimization builder actually does.
 */
const { t } = useI18n()
useSeo(() => ({
  title: t('start.seoTitle'),
  description: t('start.seoDesc'),
  canonicalPath: '/start',
}))

/** The real steps of the /create flow (lib/flowSteps.ts, easy plan). */
const CREATE_STEPS = ['plan', 'build', 'location', 'account', 'budget', 'launch'] as const
/** Only capabilities implemented in the optimization builder. */
const OPTIMIZE_FEATURES = [
  { key: 'connect', icon: 'mdi-google' },
  { key: 'analyze', icon: 'mdi-gauge' },
  { key: 'improve', icon: 'mdi-auto-fix' },
  { key: 'approve', icon: 'mdi-account-check-outline' },
] as const

const minCredits = ref<number | null>(null)
onMounted(async () => {
  try {
    minCredits.value = (await googleAdsUserApi.status()).minCredits
  } catch {
    /* the note falls back to the wording without a number */
  }
})
</script>

<template>
  <v-container class="st">
    <header class="st__head">
      <p class="st__eyebrow"><span class="st__dot" /> {{ t('start.eyebrow') }}</p>
      <h1>{{ t('start.title') }}</h1>
      <p class="st__lead">{{ t('start.lead') }}</p>
    </header>

    <div class="st__cards">
      <!-- Create: the complete process -->
      <RouterLink :to="{ name: 'create' }" class="card" data-guide="start-scratch">
        <div class="card__head">
          <span class="card__icon"><v-icon icon="mdi-rocket-launch-outline" size="22" /></span>
          <div>
            <p class="card__kicker">{{ t('start.scratchKicker') }}</p>
            <h2>{{ t('start.scratchTitle') }}</h2>
          </div>
        </div>
        <p class="card__text">{{ t('start.scratchText') }}</p>

        <div class="card__body">
          <p class="card__label">{{ t('start.scratchStepsTitle') }}</p>
          <ol class="steps">
            <li v-for="(s, i) in CREATE_STEPS" :key="s" class="steps__item">
              <span class="steps__num">{{ i + 1 }}</span>
              <span class="steps__text">
                <b>{{ t(`start.scratchSteps.${s}.title`) }}</b>
                <span>{{ t(`start.scratchSteps.${s}.text`) }}</span>
              </span>
            </li>
          </ol>
        </div>

        <p class="card__note"><v-icon icon="mdi-information-outline" size="16" /> {{ t('start.scratchNote') }}</p>
        <span class="card__cta">
          {{ t('start.scratchCta') }} <v-icon icon="mdi-arrow-right" size="18" />
        </span>
      </RouterLink>

      <!-- Optimize: an additional capability for existing campaigns -->
      <RouterLink :to="{ name: 'ads-connect' }" class="card" data-guide="start-optimize">
        <div class="card__head">
          <span class="card__icon"><v-icon icon="mdi-google-ads" size="22" /></span>
          <div>
            <p class="card__kicker">{{ t('start.optimizeKicker') }}</p>
            <h2>{{ t('start.optimizeTitle') }}</h2>
          </div>
        </div>
        <p class="card__text">{{ t('start.optimizeText') }}</p>

        <div class="card__body">
          <p class="card__label">{{ t('start.optimizeFeaturesTitle') }}</p>
          <ul class="feats">
            <li v-for="f in OPTIMIZE_FEATURES" :key="f.key" class="feats__item">
              <span class="feats__icon"><v-icon :icon="f.icon" size="16" /></span>
              <span class="steps__text">
                <b>{{ t(`start.optimizeFeatures.${f.key}.title`) }}</b>
                <span>{{ t(`start.optimizeFeatures.${f.key}.text`) }}</span>
              </span>
            </li>
          </ul>
        </div>

        <p class="card__note">
          <v-icon icon="mdi-information-outline" size="16" />
          {{ minCredits != null ? t('start.optimizeNote', { credits: minCredits }) : t('start.optimizeNoteShort') }}
        </p>
        <span class="card__cta">
          {{ t('start.optimizeCta') }} <v-icon icon="mdi-arrow-right" size="18" />
        </span>
      </RouterLink>
    </div>
  </v-container>
</template>

<style scoped>
.st {
  max-width: 1040px;
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
  max-width: 52ch;
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
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  padding: 1.75rem 1.75rem 1.6rem;
  border-radius: var(--tvz-radius-lg);
  border: 1px solid var(--tvz-glass-border);
  background:
    radial-gradient(120% 60% at 0% 0%, rgba(var(--v-theme-primary), 0.08), transparent 60%),
    var(--tvz-glass-bg);
  backdrop-filter: blur(var(--tvz-glass-blur));
  -webkit-backdrop-filter: blur(var(--tvz-glass-blur));
  box-shadow: var(--tvz-shadow-sm);
  color: inherit;
  text-decoration: none;
  overflow: hidden;
  transition:
    transform var(--tvz-dur-med, 0.25s) var(--tvz-ease-out, ease),
    box-shadow var(--tvz-dur-med, 0.25s) var(--tvz-ease-out, ease),
    border-color var(--tvz-dur-med, 0.25s) var(--tvz-ease-out, ease);
}
/* Thin brand line on top, identical on both cards. */
.card::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 3px;
  background: var(--tvz-gradient-brand);
  opacity: 0.85;
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
.card__head {
  display: flex;
  align-items: center;
  gap: 0.9rem;
}
.card__icon {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  flex: none;
  border-radius: 14px;
  background: var(--tvz-ai-soft);
  color: var(--tvz-ai);
}
.card__kicker {
  margin: 0 0 0.15rem;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.card h2 {
  margin: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.4rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.2;
}
.card__text {
  margin: 0;
  font-size: 0.93rem;
  line-height: 1.55;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.card__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-top: 1rem;
  border-top: 1px solid var(--tvz-hairline);
}
.card__label {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* Create: numbered process */
.steps,
.feats {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.steps__item,
.feats__item {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
}
.steps__num,
.feats__icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: 8px;
  font-size: 0.78rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.steps__text {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  min-width: 0;
  font-size: 0.86rem;
  line-height: 1.4;
}
.steps__text b {
  font-weight: 600;
}
.steps__text span {
  color: rgba(var(--v-theme-on-surface), 0.62);
}

.card__note {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  margin: 0;
  padding: 0.65rem 0.8rem;
  border-radius: var(--tvz-radius-md);
  background: rgba(var(--v-theme-on-surface), 0.05);
  font-size: 0.82rem;
  line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.card__note .v-icon {
  flex: none;
  margin-top: 0.1rem;
  color: rgb(var(--v-theme-primary));
}
.card__cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
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

@media (max-width: 820px) {
  .st__cards {
    grid-template-columns: minmax(0, 1fr);
  }
  .card {
    padding: 1.4rem 1.25rem 1.3rem;
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
