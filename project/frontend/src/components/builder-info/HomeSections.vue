<script setup lang="ts">
/**
 * Homepage only, under the feed: ONE compact section on how the platform
 * itself works, with a switch between the two sides (looking for a
 * business / owning one), each with its own animated walkthrough. Nothing
 * here repeats another page (the builders have their own `/ghid` pages).
 * Copy in `hsec.*`, checked against the real feed, ask gate and campaigns.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import StepPlayer from './StepPlayer.vue'
import DemoFind from './DemoFind.vue'
import DemoGrow from './DemoGrow.vue'

const { t, tm } = useI18n()
type Side = 'find' | 'grow'
const side = ref<Side>('find')

const steps = computed(() => {
  const key = side.value
  const v = tm(`hsec.${key}.steps`) as unknown
  const n = Array.isArray(v) ? v.length : 0
  return Array.from({ length: n }, (_, i) => ({
    t: t(`hsec.${key}.steps.${i}.t`),
    d: t(`hsec.${key}.steps.${i}.d`),
  }))
})
</script>

<template>
  <section class="hs">
    <div class="hs__head">
      <h2>{{ t('hsec.title') }}</h2>
      <div class="hs__switch" role="tablist">
        <button
          v-for="s in (['find', 'grow'] as Side[])"
          :key="s"
          type="button"
          role="tab"
          :aria-selected="side === s"
          :class="{ 'is-on': side === s }"
          @click="side = s"
        >
          <v-icon :icon="s === 'find' ? 'mdi-magnify' : 'mdi-storefront-outline'" size="17" />
          {{ t(`hsec.${s}.tab`) }}
        </button>
      </div>
      <p>{{ t(`hsec.${side}.lead`) }}</p>
    </div>
    <StepPlayer :key="side" :steps="steps">
      <template #demo="{ step }">
        <DemoFind v-if="side === 'find'" :step="step" />
        <DemoGrow v-else :step="step" />
      </template>
    </StepPlayer>
  </section>
</template>

<style scoped>
.hs {
  max-width: 1120px;
  margin: 0 auto;
  padding: clamp(2.5rem, 7vw, 4.5rem) clamp(1rem, 3vw, 1.75rem) 3.5rem;
}
.hs__head {
  text-align: center;
  margin-bottom: 1.6rem;
}
.hs h2 {
  margin: 0 0 1rem;
  font-family: 'Space Grotesk Variable', sans-serif;
  letter-spacing: -0.02em;
  font-size: clamp(1.5rem, 3.8vw, 2.2rem);
}
.hs__switch {
  display: inline-flex;
  gap: 0.25rem;
  padding: 0.3rem;
  border-radius: 999px;
  border: 1px solid var(--tvz-glass-border);
  background: var(--tvz-glass-bg);
}
.hs__switch button {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  border-radius: 999px;
  font-weight: 600;
  font-size: 0.92rem;
  color: rgba(var(--v-theme-on-surface), 0.65);
  transition:
    background 0.25s,
    color 0.25s;
}
.hs__switch button.is-on {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}
.hs__head > p {
  margin: 0.9rem auto 0;
  max-width: 54ch;
  color: rgba(var(--v-theme-on-surface), 0.66);
}
</style>
