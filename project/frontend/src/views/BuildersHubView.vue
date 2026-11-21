<script setup lang="ts">
/** `/ghid`: every builder on the platform, each linking to its own page. */
import { useI18n } from 'vue-i18n'

import BuilderCards from '@/components/builder-info/BuilderCards.vue'
import { useSeo } from '@/composables/useSeo'

const { t } = useI18n()
useSeo(() => ({
  title: t('binfo.common.hubTitle'),
  description: t('binfo.common.hubLead'),
  canonicalPath: '/ghid',
}))
</script>

<template>
  <div class="hub">
    <header class="hub__head">
      <p class="hub__eyebrow"><span class="hub__dot" /> {{ t('binfo.common.hubEyebrow') }}</p>
      <h1>{{ t('binfo.common.hubTitle') }}</h1>
      <p class="hub__lead">{{ t('binfo.common.hubLead') }}</p>
    </header>
    <BuilderCards />
  </div>
</template>

<style scoped>
.hub {
  max-width: 1120px;
  margin: 0 auto;
  padding: clamp(2rem, 6vw, 4.5rem) clamp(1rem, 3vw, 1.75rem) 4rem;
}
.hub__head {
  text-align: center;
  margin-bottom: 2.5rem;
}
.hub__eyebrow {
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
.hub__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--tvz-ai);
  box-shadow: 0 0 0 4px var(--tvz-ai-soft);
}
.hub h1 {
  margin: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  letter-spacing: -0.02em;
  font-size: clamp(2rem, 5.5vw, 3.2rem);
  line-height: 1.05;
}
.hub__lead {
  margin: 1rem auto 0;
  max-width: 50ch;
  font-size: 1.05rem;
  color: rgba(var(--v-theme-on-surface), 0.66);
}
</style>
