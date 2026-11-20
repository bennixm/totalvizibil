<script setup lang="ts">
import OnboardingSteps from '@/components/OnboardingSteps.vue'
import './ads.css'

/**
 * Shared chrome of the "Optimize an existing Google Ads campaign" builder:
 * the same progress strip and centered header the /create flow uses, so the
 * two builders look like one product. Presentational only.
 */
defineProps<{
  current: 'connect' | 'campaign' | 'account' | 'dashboard'
  title: string
  lead?: string
  wide?: boolean
}>()
</script>

<template>
  <v-container class="abs" :class="{ 'abs--wide': wide }">
    <OnboardingSteps mode="ads" :current="current" class="abs__steps" />
    <header class="abs__head">
      <p class="abs__eyebrow"><v-icon icon="mdi-google-ads" size="14" /> Google Ads</p>
      <h1>{{ title }}</h1>
      <p v-if="lead" class="abs__lead">{{ lead }}</p>
    </header>
    <slot />
  </v-container>
</template>

<style scoped>
.abs {
  max-width: 640px;
  padding-block: clamp(2rem, 6vw, 4rem);
}
.abs--wide {
  max-width: 980px;
}
.abs__steps {
  margin-bottom: 1.75rem;
}
.abs__head {
  text-align: center;
  margin-bottom: 1.75rem;
}
.abs__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.8rem;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: rgb(var(--v-theme-primary));
}
.abs__head h1 {
  margin: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.6rem, 4.5vw, 2.3rem);
  letter-spacing: -0.02em;
  line-height: 1.1;
  text-wrap: balance;
}
.abs__lead {
  margin: 0.75rem auto 0;
  max-width: 48ch;
  font-size: 0.98rem;
  color: rgba(var(--v-theme-on-surface), 0.66);
}
</style>
