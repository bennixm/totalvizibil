<script lang="ts">
/** Module-level counter so gradient ids stay unique across chart instances. */
const TrendChartSeq = { n: 0 }

/** Compact k / M number formatting for axis labels and callouts. */
function compact(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M'
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k'
  return String(Math.round(v))
}
</script>

<script setup lang="ts">
import { computed } from 'vue'

interface Series {
  label: string
  values: number[]
}

const props = withDefaults(
  defineProps<{
    labels: string[]
    series: Series[] // 1 or 2
    /** Format a y value for the axis / last-point callout. */
    format?: (v: number) => string
  }>(),
  { format: compact },
)

// Unique gradient ids per instance (multiple charts on one page).
const uid = `tc${(TrendChartSeq.n += 1)}`

const W = 720
const H = 300
const PAD = { l: 10, r: 10, t: 20, b: 30 }
const plotW = W - PAD.l - PAD.r
const plotH = H - PAD.t - PAD.b

const max = computed(() => Math.max(1, ...props.series.flatMap((s) => s.values)))
const count = computed(() => Math.max(props.labels.length, 1))

function px(i: number): number {
  return count.value <= 1 ? PAD.l + plotW / 2 : PAD.l + (i / (count.value - 1)) * plotW
}
function py(v: number): number {
  return PAD.t + plotH - (v / max.value) * plotH
}

/** Catmull-Rom → cubic Bézier smoothing (low tension to limit overshoot). */
function smooth(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`
  const d = [`M${pts[0].x},${pts[0].y}`]
  const k = 0.11
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    d.push(
      `C${p1.x + (p2.x - p0.x) * k},${p1.y + (p2.y - p0.y) * k} ` +
        `${p2.x - (p3.x - p1.x) * k},${p2.y - (p3.y - p1.y) * k} ` +
        `${p2.x},${p2.y}`,
    )
  }
  return d.join(' ')
}

const plotted = computed(() =>
  props.series.map((s, si) => {
    const pts = s.values.map((v, i) => ({ x: px(i), y: py(v) }))
    const line = smooth(pts)
    const base = PAD.t + plotH
    const area = pts.length
      ? `${line} L${pts[pts.length - 1].x},${base} L${pts[0].x},${base} Z`
      : ''
    const lastVal = s.values.length ? s.values[s.values.length - 1] : 0
    return { si, label: s.label, line, area, last: pts[pts.length - 1], lastVal }
  }),
)

const gridLines = computed(() =>
  [0.4, 0.8].map((f) => ({ y: PAD.t + plotH - f * plotH, v: props.format(f * max.value) })),
)

const xTicks = computed(() => {
  const n = count.value
  const idx = n <= 1 ? [0] : n <= 4 ? props.labels.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1]
  return idx.map((i) => ({ x: px(i), label: props.labels[i] ?? '' }))
})
</script>

<template>
  <div class="tc">
    <div v-if="series.length > 1" class="tc__legend">
      <span v-for="(s, i) in series" :key="s.label" class="tc__key" :class="`tc__key--${i}`">
        <i /> {{ s.label }}
        <b>{{ format(plotted[i]?.lastVal ?? 0) }}</b>
      </span>
    </div>

    <svg :viewBox="`0 0 ${W} ${H}`" class="tc__svg" preserveAspectRatio="xMidYMid meet" role="img">
      <defs>
        <linearGradient v-for="i in series.length" :id="`${uid}g${i - 1}`" :key="i" x1="0" y1="0" x2="0" y2="1">
          <stop :class="`tc__stopA tc__stopA--${i - 1}`" offset="0" />
          <stop :class="`tc__stopB tc__stopB--${i - 1}`" offset="1" />
        </linearGradient>
        <clipPath :id="`${uid}clip`">
          <rect :x="0" :y="PAD.t - 8" :width="W" :height="plotH + 8" />
        </clipPath>
      </defs>

      <g class="tc__grid">
        <template v-for="g in gridLines" :key="g.y">
          <line :x1="PAD.l" :x2="W - PAD.r" :y1="g.y" :y2="g.y" />
          <text :x="PAD.l" :y="g.y - 5">{{ g.v }}</text>
        </template>
        <line
          :x1="PAD.l"
          :x2="W - PAD.r"
          :y1="PAD.t + plotH"
          :y2="PAD.t + plotH"
          class="tc__axis"
        />
      </g>

      <g :clip-path="`url(#${uid}clip)`">
        <g v-for="p in [...plotted].reverse()" :key="p.si">
          <path :d="p.area" :fill="`url(#${uid}g${p.si})`" class="tc__area" />
          <path :d="p.line" class="tc__line" :class="`tc__line--${p.si}`" />
        </g>
      </g>
      <circle
        v-for="p in plotted"
        v-show="p.last"
        :key="p.si"
        :cx="p.last?.x"
        :cy="p.last?.y"
        r="3.5"
        class="tc__dot"
        :class="`tc__dot--${p.si}`"
      />

      <g class="tc__xticks">
        <text v-for="tk in xTicks" :key="tk.x" :x="tk.x" :y="H - 6">{{ tk.label }}</text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.tc {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.tc__legend {
  display: flex;
  gap: 1.25rem;
  font-size: 0.76rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.tc__key {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.tc__key i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}
.tc__key b {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  color: rgb(var(--v-theme-on-surface) / 0.9);
  font-variant-numeric: tabular-nums;
}
.tc__key--0 i {
  background: rgb(var(--v-theme-primary));
}
.tc__key--1 i {
  background: rgb(var(--v-theme-secondary));
}

.tc__svg {
  width: 100%;
  height: auto;
  display: block;
  overflow: visible;
}

.tc__stopA--0 {
  stop-color: rgb(var(--v-theme-primary));
  stop-opacity: 0.26;
}
.tc__stopB--0 {
  stop-color: rgb(var(--v-theme-primary));
  stop-opacity: 0.01;
}
.tc__stopA--1 {
  stop-color: rgb(var(--v-theme-secondary));
  stop-opacity: 0.2;
}
.tc__stopB--1 {
  stop-color: rgb(var(--v-theme-secondary));
  stop-opacity: 0.01;
}

.tc__grid line {
  stroke: rgb(var(--v-theme-on-surface) / 0.08);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.tc__grid .tc__axis {
  stroke: rgb(var(--v-theme-on-surface) / 0.16);
}
.tc__grid text {
  fill: rgb(var(--v-theme-on-surface) / 0.38);
  font-size: 13px;
  text-anchor: start;
}

.tc__line {
  fill: none;
  stroke-width: 2.25;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
.tc__line--0 {
  stroke: rgb(var(--v-theme-primary));
}
.tc__line--1 {
  stroke: rgb(var(--v-theme-secondary));
}
.tc__dot--0 {
  fill: rgb(var(--v-theme-primary));
}
.tc__dot--1 {
  fill: rgb(var(--v-theme-secondary));
}
.tc__dot {
  stroke: rgb(var(--v-theme-surface));
  stroke-width: 2;
}

.tc__xticks text {
  fill: rgb(var(--v-theme-on-surface) / 0.45);
  font-size: 14px;
  text-anchor: middle;
}
.tc__xticks text:first-child {
  text-anchor: start;
}
.tc__xticks text:last-child {
  text-anchor: end;
}
</style>
