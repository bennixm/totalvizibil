<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useMoney } from '@/composables/useMoney'

/**
 * A credit amount with its currency equivalent — `12.50 [chip icon]` and a
 * muted `≈ €12.50` / `≈ 63 lei` beside or beneath it. One place to keep every
 * credit figure in the app formatted the same way. The chip icon is
 * dedicated to credits — it isn't reused for anything else in the app — so
 * it doubles as the "cr" unit wherever a bare amount would otherwise need
 * the word "Credite" spelled out.
 */
const props = withDefaults(
  defineProps<{
    /** The amount, in credits. */
    credits: number
    /** Force a currency for the "≈" line (admin shows the viewed owner's). */
    currency?: 'EUR' | 'RON'
    /** Show the "≈ <fiat>" equivalent. */
    approx?: boolean
    /** Show the credits-unit icon next to the main figure. */
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
  return `${sign}${body}`
})
const approxText = computed(() => money.approx(Math.abs(props.credits), props.currency))
</script>

<template>
  <span class="cv" :class="{ 'cv--stacked': stacked }">
    <span class="cv__main">
      {{ mainText }}<v-icon v-if="unit" icon="mdi-poker-chip" size="0.78em" class="cv__unit" />
    </span>
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
/* Stacked lines are plain block children, not a flex column — a flex
   column's `align-items` is a cross-axis choice independent of the
   surrounding context, so it always left-aligns the shorter line
   regardless of whether the component sits in a right-aligned table cell
   or a left-aligned card, visibly uneven when the two lines' widths
   differ. Block children instead inherit `text-align` from whichever
   alignment the caller's own layout already established, so both lines
   share the same edge the caller intended. */
.cv--stacked {
  display: inline-block;
  text-align: inherit;
  white-space: normal;
}
.cv__main {
  display: inline;
  text-transform: none;
  letter-spacing: normal;
}
.cv__unit {
  margin-left: 0.28em;
  opacity: 0.75;
  vertical-align: -0.05em;
}
.cv__x {
  display: inline;
  font-size: 0.82em;
  font-weight: 400;
  text-transform: none;
  letter-spacing: normal;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.cv--stacked .cv__main,
.cv--stacked .cv__x {
  display: block;
}
.cv--stacked .cv__x {
  margin-top: 0.1rem;
}
</style>
