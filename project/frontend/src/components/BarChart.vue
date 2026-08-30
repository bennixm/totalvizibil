<script setup lang="ts">
import { computed } from 'vue'

interface Series {
  label: string
  values: number[]
}

const props = defineProps<{
  labels: string[]
  series: Series[] // 1 or 2
}>()

const W = 640
const H = 148
const PAD = { l: 6, r: 6, t: 14, b: 20 }
const plotW = W - PAD.l - PAD.r
const plotH = H - PAD.t - PAD.b

const max = computed(() => Math.max(1, ...props.series.flatMap((s) => s.values)))
const n = computed(() => props.labels.length)
const slot = computed(() => plotW / Math.max(1, n.value))

function y(v: number): number {
  return PAD.t + plotH - (v / max.value) * plotH
}

const grid = computed(() => {
  const steps = [0, 0.5, 1]
  return steps.map((f) => ({
    y: PAD.t + plotH - f * plotH,
    v: Math.round(f * max.value),
  }))
})

const bars = computed(() => {
  const seriesCount = props.series.length
  const groupW = slot.value * 0.62
  const barW = groupW / seriesCount
  const out: Array<{ x: number; y: number; h: number; si: number; last: boolean }> = []
  props.series.forEach((s, si) => {
    s.values.forEach((v, i) => {
      const gx = PAD.l + i * slot.value + (slot.value - groupW) / 2
      const yy = y(v)
      out.push({
        x: gx + si * barW,
        y: yy,
        h: Math.max(0, PAD.t + plotH - yy),
        si,
        last: i === n.value - 1,
      })
    })
  })
  return out
})

const ticks = computed(() => {
  const idx = n.value <= 1 ? [0] : [0, Math.floor((n.value - 1) / 2), n.value - 1]
  return idx.map((i) => ({
    x: PAD.l + i * slot.value + slot.value / 2,
    label: (props.labels[i] ?? '').slice(5).replace('-', '.'),
  }))
})
</script>

<template>
  <div class="bc">
    <div class="bc__legend">
      <span v-for="(s, i) in series" :key="s.label" class="bc__key" :class="`bc__key--${i}`">
        <i /> {{ s.label }}
      </span>
    </div>
    <svg :viewBox="`0 0 ${W} ${H}`" class="bc__svg" preserveAspectRatio="xMidYMid meet" role="img">
      <g class="bc__grid">
        <template v-for="g in grid" :key="g.y">
          <line :x1="PAD.l" :x2="W - PAD.r" :y1="g.y" :y2="g.y" />
          <text :x="PAD.l" :y="g.y - 3">{{ g.v }}</text>
        </template>
      </g>
      <g>
        <rect
          v-for="(b, i) in bars"
          :key="i"
          :x="b.x"
          :y="b.y"
          :width="Math.max(1.5, (slot * 0.62) / series.length - 1.5)"
          :height="b.h"
          rx="2"
          class="bc__bar"
          :class="[`bc__bar--${b.si}`, { 'is-last': b.last }]"
        />
      </g>
      <g class="bc__ticks">
        <text v-for="tk in ticks" :key="tk.x" :x="tk.x" :y="H - 6">{{ tk.label }}</text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.bc {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.bc__legend {
  display: flex;
  gap: 1rem;
  font-size: 0.72rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.bc__key {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.bc__key i {
  width: 9px;
  height: 9px;
  border-radius: 3px;
}
.bc__key--0 i {
  background: rgb(var(--v-theme-primary));
}
.bc__key--1 i {
  background: rgb(var(--v-theme-secondary));
}
.bc__svg {
  width: 100%;
  height: auto;
  display: block;
}
.bc__grid line {
  stroke: rgb(var(--v-theme-on-surface) / 0.08);
  stroke-width: 1;
}
.bc__grid text {
  fill: rgb(var(--v-theme-on-surface) / 0.4);
  font-size: 9px;
  font-family: ui-monospace, monospace;
}
.bc__bar--0 {
  fill: rgb(var(--v-theme-primary) / 0.55);
}
.bc__bar--1 {
  fill: rgb(var(--v-theme-secondary) / 0.55);
}
.bc__bar--0.is-last {
  fill: rgb(var(--v-theme-primary));
}
.bc__bar--1.is-last {
  fill: rgb(var(--v-theme-secondary));
}
.bc__ticks text {
  fill: rgb(var(--v-theme-on-surface) / 0.45);
  font-size: 9px;
  font-family: ui-monospace, monospace;
  text-anchor: middle;
}
</style>
