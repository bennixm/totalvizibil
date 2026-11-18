<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import type { SupportPersonRole } from '@/stores/support'

/** The role label next to a person's name anywhere in Support: list rows,
 *  the conversation, the sidebar. One colour per role, same everywhere. */
defineProps<{ role: SupportPersonRole }>()
const { t } = useI18n()
</script>

<template>
  <span class="srb" :class="`srb--${role}`">{{ t('support.role.' + role) }}</span>
</template>

<style scoped>
.srb {
  display: inline-flex;
  align-items: center;
  flex: none;
  padding: 0.08rem 0.42rem;
  border-radius: 999px;
  /* Badge size of the admin typography scale (was 9.9px). */
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.5;
  white-space: nowrap;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.62);
}
.srb--admin {
  background: rgba(var(--v-theme-primary), 0.16);
  color: rgb(var(--v-theme-primary));
}
.srb--support {
  background: rgba(var(--v-theme-info), 0.16);
  color: rgb(var(--v-theme-info));
}
.srb--finance {
  background: rgba(var(--v-theme-success), 0.16);
  color: rgb(var(--v-theme-success));
}
.srb--moderator {
  background: rgba(var(--v-theme-warning), 0.16);
  color: rgb(var(--v-theme-warning));
}
</style>
