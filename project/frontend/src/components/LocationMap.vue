<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useTheme } from 'vuetify'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const props = defineProps<{
  lat: number
  lng: number
  radiusKm: number
}>()

const emit = defineEmits<{ pick: [{ lat: number; lng: number }] }>()

const theme = useTheme()
const el = ref<HTMLElement | null>(null)

let map: L.Map | null = null
let centre: L.CircleMarker | null = null
let ring: L.Circle | null = null
let ro: ResizeObserver | null = null

function render(fit: boolean): void {
  if (!map) return
  const pos: L.LatLngExpression = [props.lat, props.lng]
  // A non-positive radius means "whole country" — draw only the centre pin.
  const showRing = props.radiusKm > 0
  const radius = Math.max(props.radiusKm, 0.5) * 1000

  if (!showRing) {
    if (ring) {
      ring.remove()
      ring = null
    }
  } else if (!ring) {
    ring = L.circle(pos, {
      radius,
      color: '#3f63e8',
      weight: 1,
      fillColor: '#3f63e8',
      fillOpacity: 0.12,
    }).addTo(map)
  } else {
    ring.setLatLng(pos)
    ring.setRadius(radius)
  }

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

  if (fit) {
    if (ring) map.fitBounds(ring.getBounds(), { padding: [24, 24], maxZoom: 13 })
    else map.setView(pos, 11)
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

  map.on('click', (e: L.LeafletMouseEvent) => {
    emit('pick', { lat: e.latlng.lat, lng: e.latlng.lng })
  })

  render(true)

  ro = new ResizeObserver(() => map?.invalidateSize())
  ro.observe(el.value)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  map?.remove()
  map = null
})

// City change → recentre + fit. Radius change → just resize the ring.
watch(
  () => [props.lat, props.lng] as const,
  () => render(true),
)
watch(
  () => props.radiusKm,
  () => render(true),
)
</script>

<template>
  <div ref="el" class="map" :class="{ 'map--dark': theme.global.current.value.dark }" />
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
</style>
