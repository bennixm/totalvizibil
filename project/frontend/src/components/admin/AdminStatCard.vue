<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, type RouteLocationRaw } from 'vue-router'

const props = defineProps<{
  label: string
  value: string | number
  icon?: string
  /** Accent colour token; drives icon + value tint when set. */
  tone?: 'primary' | 'success' | 'error' | 'warning'
  sub?: string
  to?: RouteLocationRaw
}>()

const router = useRouter()
const clickable = computed(() => props.to !== undefined)
function go() {
  if (props.to) void router.push(props.to)
}
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'"
    class="asc"
    :class="[tone ? `asc--${tone}` : '', { 'asc--link': clickable }]"
    :type="clickable ? 'button' : undefined"
    @click="go"
  >
    <div class="asc__top">
      <span class="asc__label">{{ label }}</span>
      <v-icon v-if="icon" :icon="icon" size="18" class="asc__icon" />
    </div>
    <div class="asc__value">{{ value }}</div>
    <div v-if="sub" class="asc__sub">{{ sub }}</div>
  </component>
</template>

<style scoped>
.asc {
  --asc-acc: var(--v-theme-on-surface);
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  text-align: left;
  width: 100%;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  padding: 0.95rem 1.05rem;
  transition:
    border-color var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease),
    transform var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease);
}
.asc--primary {
  --asc-acc: var(--v-theme-primary);
}
.asc--success {
  --asc-acc: var(--v-theme-success);
}
.asc--error {
  --asc-acc: var(--v-theme-error);
}
.asc--warning {
  --asc-acc: var(--v-theme-warning);
}
.asc--link {
  cursor: pointer;
}
.asc--link:hover {
  border-color: rgb(var(--asc-acc) / 0.5);
  transform: translateY(-1px);
}
.asc__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.asc__label {
  font-size: 0.74rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.asc__icon {
  color: rgb(var(--asc-acc) / 0.9);
}
.asc__value {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: 1.55rem;
  letter-spacing: -0.02em;
  margin-top: 0.35rem;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--asc-acc));
}
.asc__sub {
  font-size: 0.72rem;
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
</style>
