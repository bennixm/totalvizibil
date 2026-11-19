<script setup lang="ts">
/** One status pill: semantic tone + icon + label. Colour is never the only
 *  signal (icon and text carry the meaning too). */
import type { Tone } from './useInvoiceFormat'

defineProps<{ label: string; tone: Tone; icon?: string; size?: 'sm' | 'md' }>()
</script>

<template>
  <span class="ib" :class="[`ib--${tone}`, `ib--${size ?? 'sm'}`]">
    <v-icon v-if="icon" :icon="icon" :size="size === 'md' ? 15 : 13" aria-hidden="true" />
    <span>{{ label }}</span>
  </span>
</template>

<style scoped>
.ib {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  max-width: 100%;
  padding: 0.12rem 0.45rem 0.12rem 0.35rem;
  border-radius: 5px;
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  line-height: 1.35;
  white-space: nowrap;
}
.ib span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.ib--md {
  padding: 0.2rem 0.6rem 0.2rem 0.45rem;
  font-size: var(--tvz-fs-small);
}
.ib--success {
  background: rgba(var(--v-theme-success), 0.13);
  color: rgb(var(--v-theme-success));
}
.ib--warning {
  background: rgba(var(--v-theme-warning), 0.15);
  color: rgb(var(--v-theme-warning));
}
.ib--error {
  background: rgba(var(--v-theme-error), 0.14);
  color: rgb(var(--v-theme-error));
}
.ib--info {
  background: rgba(var(--v-theme-info), 0.13);
  color: rgb(var(--v-theme-info));
}
.ib--primary {
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}
.ib--neutral {
  background: rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.62);
}
</style>
