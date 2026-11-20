<script setup lang="ts">
/** Small status tag used across the Google Ads agent screens. */
defineProps<{ tone?: 'success' | 'warning' | 'error' | 'neutral' | 'primary'; icon?: string }>()
</script>

<template>
  <span class="gac" :class="`gac--${tone ?? 'neutral'}`">
    <v-icon v-if="icon" :icon="icon" size="12" />
    <slot />
  </span>
</template>

<style scoped>
.gac {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 600;
  line-height: 1.5;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  white-space: nowrap;
}
.gac--success {
  background: rgba(var(--v-theme-success), 0.12);
  color: rgb(var(--v-theme-success));
}
.gac--warning {
  background: rgba(var(--v-theme-warning), 0.14);
  color: rgb(var(--v-theme-warning));
}
.gac--error {
  background: rgba(var(--v-theme-error), 0.12);
  color: rgb(var(--v-theme-error));
}
.gac--primary {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.gac--neutral {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.65);
}
</style>
