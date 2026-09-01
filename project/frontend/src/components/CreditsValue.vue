<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useMoney } from '@/composables/useMoney'

/**
 * A credit amount with its currency equivalent — `12.50 cr` and a muted
 * `≈ €12.50` / `≈ 63 lei` beside or beneath it. One place to keep every credit
 * figure in the app formatted the same way.
 */
const props = withDefaults(
  defineProps<{
    /** The amount, in credits. */
    credits: number
    /** Force a currency for the "≈" line (admin shows the viewed owner's). */
    currency?: 'EUR' | 'RON'
    /** Show the "≈ <fiat>" equivalent. */
    approx?: boolean
    /** Append the " cr" unit to the main figure. */
    unit?: boolean
    /** Stack the equivalent under the figure instead of trailing it. */
    stacked?: boolean
    /** Render the main figure only as `+12.50` / `−12.50`. */
    signed?: boolean
  }>(),
  { approx: true, unit: true, stacked: false, signed: false },
)

const { n } = useI18n()
const money = useMoney()

const mainText = computed(() => {
  const sign = props.signed ? (props.credits > 0 ? '+' : props.credits < 0 ? '−' : '') : ''
  const body = n(props.signed ? Math.abs(props.credits) : props.credits, {
    maximumFractionDigits: 2,
  })
  return `${sign}${body}${props.unit ? ' cr' : ''}`
})
const approxText = computed(() => money.approx(Math.abs(props.credits), props.currency))
</script>

<template>
  <span class="cv" :class="{ 'cv--stacked': stacked }">
    <span class="cv__main">{{ mainText }}</span>
    <span v-if="approx" class="cv__x">{{ approxText }}</span>
  </span>
</template>

<style scoped>
.cv {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  white-space: nowrap;
  text-transform: none;
  letter-spacing: normal;
}
.cv--stacked {
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
}
.cv__main {
  display: inline;
  text-transform: none;
  letter-spacing: normal;
}
.cv__x {
  display: inline;
  font-size: 0.82em;
  font-weight: 400;
  text-transform: none;
  letter-spacing: normal;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.cv--stacked .cv__main,
.cv--stacked .cv__x {
  display: block;
}
</style>
