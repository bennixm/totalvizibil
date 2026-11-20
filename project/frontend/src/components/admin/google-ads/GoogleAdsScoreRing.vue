<script setup lang="ts">
/** Circular 0-100 score indicator; `null` = not evaluable (shown as "–"). */
import { computed } from 'vue'
import { scoreTone } from '@/services/google-ads-optimization'

const props = withDefaults(
  defineProps<{ score: number | null | undefined; size?: number; stroke?: number }>(),
  {
    size: 120,
    stroke: 10,
  },
)

const r = computed(() => (props.size - props.stroke) / 2)
const circ = computed(() => 2 * Math.PI * r.value)
const offset = computed(() => circ.value * (1 - Math.max(0, Math.min(100, props.score ?? 0)) / 100))
const tone = computed(() => scoreTone(props.score))
</script>

<template>
  <div class="gsr" :class="`gsr--${tone}`" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`" aria-hidden="true">
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="r"
        class="gsr__track"
        :stroke-width="stroke"
        fill="none"
      />
      <circle
        v-if="score !== null && score !== undefined"
        :cx="size / 2"
        :cy="size / 2"
        :r="r"
        class="gsr__bar"
        :stroke-width="stroke"
        fill="none"
        stroke-linecap="round"
        :stroke-dasharray="circ"
        :stroke-dashoffset="offset"
        :transform="`rotate(-90 ${size / 2} ${size / 2})`"
      />
    </svg>
    <span class="gsr__value" :style="{ fontSize: `${Math.round(size / 3.6)}px` }">
      {{ score ?? '–' }}<small v-if="score !== null && score !== undefined">%</small>
    </span>
  </div>
</template>

<style scoped>
.gsr {
  position: relative;
  display: inline-grid;
  place-items: center;
  flex: none;
}
.gsr svg {
  position: absolute;
  inset: 0;
}
.gsr__track {
  stroke: rgba(var(--v-theme-on-surface), 0.08);
}
.gsr__bar {
  transition: stroke-dashoffset 0.6s ease;
}
.gsr--success .gsr__bar {
  stroke: rgb(var(--v-theme-success));
}
.gsr--warning .gsr__bar {
  stroke: rgb(var(--v-theme-warning));
}
.gsr--error .gsr__bar {
  stroke: rgb(var(--v-theme-error));
}
.gsr__value {
  position: relative;
  font-weight: 700;
  font-family: 'Space Grotesk Variable', 'Space Grotesk', sans-serif;
  line-height: 1;
}
.gsr__value small {
  font-size: 0.5em;
  opacity: 0.6;
  margin-left: 1px;
}
</style>
