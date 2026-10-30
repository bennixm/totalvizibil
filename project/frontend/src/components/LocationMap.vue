<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useTheme } from 'vuetify'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface OverviewMarker {
  lat: number
  lng: number
  label: string
}

const props = withDefaults(
  defineProps<{
    lat: number
    lng: number
    /** Several counties selected at once — no single address to pick, so the
     *  map switches to a non-interactive overview: one labelled marker per
     *  county instead of one draggable pin. */
    markers?: OverviewMarker[] | null
  }>(),
  { markers: null },
)

const emit = defineEmits<{ pick: [{ lat: number; lng: number }] }>()

const theme = useTheme()
const el = ref<HTMLElement | null>(null)

const isOverview = (): boolean => !!props.markers && props.markers.length > 0

let map: L.Map | null = null
let centre: L.CircleMarker | null = null
let overviewMarkers: L.Layer[] = []
let clickHandler: ((e: L.LeafletMouseEvent) => void) | null = null
let ro: ResizeObserver | null = null

function clearOverviewMarkers(): void {
  for (const m of overviewMarkers) m.remove()
  overviewMarkers = []
}
function clearPin(): void {
  centre?.remove()
  centre = null
}

function renderOverview(): void {
  if (!map || !props.markers) return
  clearPin()
  clearOverviewMarkers()
  const pts: L.LatLngExpression[] = []
  for (const m of props.markers) {
    const pos: L.LatLngExpression = [m.lat, m.lng]
    pts.push(pos)
    const marker = L.circleMarker(pos, {
      radius: 6,
      color: '#fff',
      weight: 2,
      fillColor: '#3f63e8',
      fillOpacity: 1,
    })
      .bindTooltip(m.label, { permanent: true, direction: 'top', offset: [0, -6], className: 'map__tip' })
      .addTo(map)
    overviewMarkers.push(marker)
  }
  // A map whose container was just created (or re-created — see the mount-time
  // race note on renderPin below) hasn't necessarily settled its internal
  // pixel-origin/size yet; invalidateSize() forces Leaflet to recompute that
  // against the CURRENT real layout right before we pan, so the pan lands
  // correctly instead of being computed against a stale/zero-sized frame.
  map.invalidateSize()
  if (pts.length === 1) map.setView(pts[0], 9, { animate: false })
  else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [32, 32], maxZoom: 8, animate: false })
}

function renderPin(fit: boolean): void {
  if (!map) return
  clearOverviewMarkers()
  const pos: L.LatLngExpression = [props.lat, props.lng]

  if (!centre) {
    centre = L.circleMarker(pos, {
      radius: 7,
      color: '#fff',
      weight: 2,
      fillColor: '#3f63e8',
      fillOpacity: 1,
    }).addTo(map)
  } else {
    centre.setLatLng(pos)
  }

  // Same invalidateSize()-before-pan fix as renderOverview() above. This
  // matters most right after a fresh mount: the map is constructed with
  // whatever lat/lng the parent happened to hold at that instant (often a
  // stale default or the previous selection's city, since the real
  // county-center lookup is async and hasn't resolved yet), then a SECOND
  // setView() lands moments later once the lookup completes. Without
  // invalidateSize() + animate:false, that second call was observed to
  // silently no-op on a just-constructed map (confirmed via instrumentation:
  // the watcher fires, props are correct, setView() runs, but the view
  // visibly stayed on the first, wrong position) — the map never actually
  // caught up, leaving the previous county's city on screen indefinitely.
  if (fit) {
    map.invalidateSize()
    map.setView(pos, 11, { animate: false })
  }
}

function render(fit: boolean): void {
  if (isOverview()) renderOverview()
  else renderPin(fit)
}

function syncInteractivity(): void {
  if (!map) return
  if (clickHandler) {
    map.off('click', clickHandler)
    clickHandler = null
  }
  if (!isOverview()) {
    clickHandler = (e: L.LeafletMouseEvent) => emit('pick', { lat: e.latlng.lat, lng: e.latlng.lng })
    map.on('click', clickHandler)
  }
}

onMounted(() => {
  if (!el.value) return
  map = L.map(el.value, { attributionControl: true, zoomControl: true }).setView(
    [props.lat, props.lng],
    12,
  )
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  }).addTo(map)

  syncInteractivity()
  render(true)

  ro = new ResizeObserver(() => map?.invalidateSize())
  ro.observe(el.value)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  map?.remove()
  map = null
})

watch(
  () => [props.lat, props.lng] as const,
  () => render(true),
)
watch(
  () => props.markers,
  () => {
    syncInteractivity()
    render(true)
  },
)
</script>

<template>
  <div
    ref="el"
    class="map"
    :class="{ 'map--dark': theme.global.current.value.dark, 'map--overview': isOverview() }"
  />
</template>

<style scoped>
.map {
  width: 100%;
  height: 100%;
  min-height: 260px;
  border-radius: var(--tvz-radius-lg);
  overflow: hidden;
  border: 1px solid var(--tvz-glass-border);
  z-index: 0;
}
.map :deep(.leaflet-container) {
  background: rgb(var(--v-theme-surface));
  font: inherit;
}
/* OSM tiles are light-only — nudge them toward the dark theme. */
.map--dark :deep(.leaflet-tile) {
  filter: invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.9);
}
.map--dark :deep(.leaflet-control-attribution) {
  background: rgb(0 0 0 / 0.6);
  color: rgb(255 255 255 / 0.7);
}
.map :deep(.leaflet-bar a) {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  border-color: var(--tvz-glass-border);
}
/* Overview mode (several counties) is read-only — no crosshair pick cursor. */
.map--overview :deep(.leaflet-container) {
  cursor: default;
}
.map :deep(.leaflet-tooltip.map__tip) {
  padding: 0.2rem 0.5rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--tvz-glass-border);
  border-radius: 6px;
  box-shadow: none;
}
.map :deep(.leaflet-tooltip.map__tip::before) {
  display: none;
}
</style>
