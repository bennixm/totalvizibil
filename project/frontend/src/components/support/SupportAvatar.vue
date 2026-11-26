<script setup lang="ts">
import { computed } from 'vue'

import type { SupportPersonRole } from '@/stores/support'

/** Initials avatar, tinted by role so the team reads apart from customers at
 *  a glance. `name` empty = an unassigned slot (dashed outline). */
const props = withDefaults(
  defineProps<{ name?: string | null; role?: SupportPersonRole; size?: number }>(),
  { name: null, role: 'user', size: 32 },
)

const initials = computed(() => {
  const parts = (props.name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return ''
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase()
})
</script>

<template>
  <span
    class="sav"
    :class="[`sav--${role}`, { 'sav--empty': !initials }]"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.max(10, Math.round(size * 0.38))}px` }"
    aria-hidden="true"
  >
    <template v-if="initials">{{ initials }}</template>
    <v-icon v-else icon="mdi-account-outline" :size="Math.round(size * 0.55)" />
  </span>
</template>

<style scoped>
.sav {
  display: inline-grid;
  place-items: center;
  flex: none;
  border-radius: 50%;
  font-weight: 700;
  letter-spacing: 0.02em;
  background: rgba(var(--v-theme-on-surface), 0.1);
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.sav--admin {
  background: rgba(var(--v-theme-primary), 0.2);
  color: rgb(var(--v-theme-primary));
}
.sav--support {
  background: rgba(var(--v-theme-info), 0.2);
  color: rgb(var(--v-theme-info));
}
.sav--finance {
  background: rgba(var(--v-theme-success), 0.2);
  color: rgb(var(--v-theme-success));
}
.sav--moderator {
  background: rgba(var(--v-theme-warning), 0.2);
  color: rgb(var(--v-theme-warning));
}
.sav--empty {
  background: transparent;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.3);
  color: rgba(var(--v-theme-on-surface), 0.4);
}
</style>
