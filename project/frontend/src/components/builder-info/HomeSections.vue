<script setup lang="ts">
/**
 * Homepage only, under the feed: how the platform works for both sides,
 * in the same interactive style as the builder guides. Visitors: ask →
 * category + county → businesses nearby → contact. Businesses: site →
 * area + category → campaign → in the feed, getting requests. Then the
 * builders and a final call to action. Copy in `hsec.*`, checked against
 * the real feed, ask gate and campaign flow.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import StepPlayer from './StepPlayer.vue'
import DemoFind from './DemoFind.vue'
import DemoGrow from './DemoGrow.vue'
import BuilderCards from './BuilderCards.vue'

const { t, tm } = useI18n()

function steps(key: string): { t: string; d: string }[] {
  const v = tm(`hsec.${key}.steps`) as unknown
  const n = Array.isArray(v) ? v.length : 0
  return Array.from({ length: n }, (_, i) => ({
    t: t(`hsec.${key}.steps.${i}.t`),
    d: t(`hsec.${key}.steps.${i}.d`),
  }))
}
const findSteps = computed(() => steps('find'))
const growSteps = computed(() => steps('grow'))

const reduced =
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
function backToSearch(): void {
  window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
}
</script>

<template>
  <div class="hs">
    <section class="hs__sec">
      <div class="hs__head">
        <p class="hs__eyebrow"><v-icon icon="mdi-magnify" size="15" /> {{ t('hsec.find.eyebrow') }}</p>
        <h2>{{ t('hsec.find.title') }}</h2>
        <p>{{ t('hsec.find.lead') }}</p>
      </div>
      <StepPlayer :steps="findSteps">
        <template #demo="{ step }"><DemoFind :step="step" /></template>
      </StepPlayer>
    </section>

    <section class="hs__sec">
      <div class="hs__head">
        <p class="hs__eyebrow"><v-icon icon="mdi-storefront-outline" size="15" /> {{ t('hsec.grow.eyebrow') }}</p>
        <h2>{{ t('hsec.grow.title') }}</h2>
        <p>{{ t('hsec.grow.lead') }}</p>
      </div>
      <StepPlayer :steps="growSteps">
        <template #demo="{ step }"><DemoGrow :step="step" /></template>
      </StepPlayer>
    </section>

    <section class="hs__sec">
      <div class="hs__head">
        <p class="hs__eyebrow"><v-icon icon="mdi-creation" size="15" /> {{ t('hsec.builders.eyebrow') }}</p>
        <h2>{{ t('hsec.builders.title') }}</h2>
        <p>{{ t('hsec.builders.lead') }}</p>
      </div>
      <BuilderCards />
    </section>

    <section class="hs__final">
      <h2>{{ t('hsec.final.title') }}</h2>
      <div class="hs__actions">
        <v-btn variant="tonal" size="large" prepend-icon="mdi-magnify" @click="backToSearch">
          {{ t('hsec.final.find') }}
        </v-btn>
        <v-btn :to="{ name: 'start' }" color="primary" size="large" append-icon="mdi-arrow-right">
          {{ t('hsec.final.grow') }}
        </v-btn>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hs {
  max-width: 1120px;
  margin: 0 auto;
  padding: clamp(2.5rem, 7vw, 5rem) clamp(1rem, 3vw, 1.75rem) 3rem;
  display: flex;
  flex-direction: column;
  gap: clamp(3.5rem, 9vw, 6rem);
}
.hs h2 {
  margin: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  letter-spacing: -0.02em;
  font-size: clamp(1.5rem, 3.8vw, 2.2rem);
  text-wrap: balance;
}
.hs__head {
  text-align: center;
  margin-bottom: 1.8rem;
}
.hs__head > p:not(.hs__eyebrow) {
  margin: 0.6rem auto 0;
  max-width: 54ch;
  color: rgba(var(--v-theme-on-surface), 0.66);
}
.hs__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.8rem;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--tvz-ai);
  background: var(--tvz-ai-soft);
}
.hs__final {
  text-align: center;
  padding: clamp(2rem, 6vw, 3.5rem) 1.5rem;
  border-radius: 24px;
  background:
    radial-gradient(120% 140% at 50% 0%, rgba(var(--v-theme-primary), 0.22), transparent 60%),
    var(--tvz-glass-bg);
  border: 1px solid var(--tvz-glass-border);
}
.hs__final h2 {
  max-width: 26ch;
  margin: 0 auto 1.5rem;
}
.hs__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.7rem;
}
</style>
