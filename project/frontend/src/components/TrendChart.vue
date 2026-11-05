<script lang="ts">
/** Compact k / M number formatting for axis labels and callouts. */
function compact(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M'
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k'
  return String(Math.round(v))
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { useTheme } from 'vuetify'
// Modular ApexCharts build — only the pieces this chart actually uses
// (area type + legend/toolbar features), not the full library with every
// chart type (candlestick, treemap, pictograms, ...). Cuts the lazy-loaded
// chunk from ~175KB gzip to a fraction of that. See the "Tree-shaking"
// section of apexcharts' README for the full list of entry points.
import VueApexCharts from 'vue3-apexcharts/core'
import 'apexcharts/area'
import 'apexcharts/features/legend'
import 'apexcharts/features/toolbar'
import type { ApexOptions } from 'apexcharts'

interface Series {
  label: string
  values: number[]
}

const props = withDefaults(
  defineProps<{
    labels: string[]
    series: Series[] // 1 or 2
    /** Format a y value for the axis / tooltip / last-point callout. */
    format?: (v: number) => string
  }>(),
  { format: compact },
)

const theme = useTheme()

// Resolved literal colors (never CSS var() strings) so every value baked
// into the chart's options object — gradients, marker strokes, the tooltip
// theme flag — is correct the instant it's built. The component is re-keyed
// by theme name below, so a theme toggle fully remounts it with fresh colors
// rather than relying on ApexCharts to pick up a live CSS variable change.
const palette = computed(() => {
  const colors = theme.current.value.colors as Record<string, string>
  const vars = theme.current.value.variables as Record<string, string>
  return {
    series: [colors.primary, colors.secondary],
    surface: colors.surface,
    ink: vars['border-color'] ?? (theme.current.value.dark ? '#EEF1F7' : '#131722'),
  }
})

const reduceMotion =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const apexSeries = computed(() => props.series.map((s) => ({ name: s.label, data: s.values })))

const lastValues = computed(() => props.series.map((s) => s.values[s.values.length - 1] ?? 0))

const lastIndex = computed(() => props.labels.length - 1)

const options = computed<ApexOptions>(() => {
  const { series: seriesColors, surface, ink } = palette.value
  const inkFaint = hexToRgba(ink, 0.08)
  const inkDim = hexToRgba(ink, 0.45)
  const inkLabel = hexToRgba(ink, 0.6)

  return {
    chart: {
      type: 'area',
      fontFamily: "'Inter Variable', sans-serif",
      foreColor: inkDim,
      background: 'transparent',
      toolbar: {
        show: true,
        tools: {
          download: false,
          selection: false,
          zoom: true,
          zoomin: true,
          zoomout: true,
          pan: true,
          reset: true,
        },
      },
      zoom: { enabled: true, autoScaleYaxis: true },
      animations: { enabled: !reduceMotion, speed: 280 },
    },
    colors: seriesColors,
    stroke: { curve: 'smooth', width: 2.25, lineCap: 'round' },
    fill: {
      type: 'gradient',
      gradient: { shadeIntensity: 1, opacityFrom: 0.3, opacityTo: 0.02, stops: [0, 100] },
    },
    dataLabels: { enabled: false },
    markers: {
      size: 0,
      hover: { size: 5 },
      strokeWidth: 2,
      strokeColors: surface,
      discrete: props.series.map((_, si) => ({
        seriesIndex: si,
        dataPointIndex: lastIndex.value,
        size: 3.5,
        fillColor: seriesColors[si % seriesColors.length],
        strokeColor: surface,
        strokeWidth: 2,
      })),
    },
    grid: {
      borderColor: inkFaint,
      strokeDashArray: 0,
      xaxis: { lines: { show: false } },
      padding: { left: 8, right: 8, top: 0, bottom: 0 },
    },
    xaxis: {
      categories: props.labels,
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: { colors: inkDim, fontSize: '12px' }, rotate: 0 },
      tooltip: { enabled: false },
      crosshairs: { stroke: { color: inkFaint, width: 1, dashArray: 0 } },
    },
    yaxis: {
      labels: {
        formatter: (v: number) => props.format(v),
        style: { colors: inkDim, fontSize: '12px' },
      },
    },
    legend: {
      show: props.series.length > 1,
      position: 'top',
      horizontalAlign: 'left',
      fontSize: '13px',
      fontWeight: 600,
      labels: { colors: inkLabel },
      markers: { size: 5, offsetX: -2 },
      itemMargin: { horizontal: 14, vertical: 6 },
      formatter: (name: string, opts?: { seriesIndex: number }) =>
        `${name}  ${props.format(lastValues.value[opts?.seriesIndex ?? 0] ?? 0)}`,
    },
    tooltip: {
      theme: theme.current.value.dark ? 'dark' : 'light',
      shared: true,
      intersect: false,
      y: { formatter: (v: number) => props.format(v) },
    },
  }
})
</script>

<template>
  <VueApexCharts
    :key="theme.global.name.value"
    class="tc"
    type="area"
    height="260"
    :options="options"
    :series="apexSeries"
  />
</template>

<style scoped>
.tc {
  width: 100%;
}
.tc :deep(.apexcharts-toolbar) {
  opacity: 0.45;
  transition: opacity 0.15s ease;
}
.tc:hover :deep(.apexcharts-toolbar) {
  opacity: 0.9;
}
/* Every toolbar icon's SVG uses `stroke="currentColor"`, but ApexCharts'
   own stylesheet sets a fixed dark-grey `color` directly on each
   `.apexcharts-*-icon` element (not just inherited from `.apexcharts-toolbar`)
   — equal specificity to an ancestor-only rule here, so it was winning and
   the icons stayed that same grey (invisible against a dark card) in both
   themes. Targeting the icon elements themselves, not just their container,
   is what actually overrides it. */
.tc :deep(.apexcharts-menu-icon),
.tc :deep(.apexcharts-reset-icon),
.tc :deep(.apexcharts-zoom-icon),
.tc :deep(.apexcharts-zoomin-icon),
.tc :deep(.apexcharts-zoomout-icon),
.tc :deep(.apexcharts-pan-icon),
.tc :deep(.apexcharts-selection-icon) {
  color: rgba(var(--v-theme-on-surface), 0.55);
  transition: color 0.15s ease;
}
.tc :deep(.apexcharts-menu-icon:hover),
.tc :deep(.apexcharts-reset-icon:hover),
.tc :deep(.apexcharts-zoom-icon:hover),
.tc :deep(.apexcharts-zoomin-icon:hover),
.tc :deep(.apexcharts-zoomout-icon:hover),
.tc :deep(.apexcharts-pan-icon:hover),
.tc :deep(.apexcharts-selection-icon:hover) {
  color: rgb(var(--v-theme-on-surface));
}
/* The active tool (e.g. "zoom" selected) gets ApexCharts' own highlight
   background — recolour it off our primary token instead of its default
   light-only blue, which read as a flat grey smear on a dark card. */
.tc :deep(.apexcharts-selected) {
  background: rgba(var(--v-theme-primary), 0.16) !important;
  border-radius: 4px;
  color: rgb(var(--v-theme-primary)) !important;
}
.tc :deep(.apexcharts-menu-icon svg),
.tc :deep(.apexcharts-reset-icon svg),
.tc :deep(.apexcharts-zoom-icon svg),
.tc :deep(.apexcharts-zoomin-icon svg),
.tc :deep(.apexcharts-zoomout-icon svg),
.tc :deep(.apexcharts-pan-icon svg),
.tc :deep(.apexcharts-selection-icon svg) {
  width: 16px;
  height: 16px;
}
</style>
