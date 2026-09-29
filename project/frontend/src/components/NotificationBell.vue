<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import { useNotificationsStore } from '@/stores/notifications'

const { t } = useI18n()
const store = useNotificationsStore()
const { unreadCount } = storeToRefs(store)

const badgeText = computed(() => (unreadCount.value > 9 ? '9+' : String(unreadCount.value)))

function toggleDrawer(): void {
  if (store.drawerOpen) {
    store.drawerOpen = false
    return
  }
  store.drawerOpen = true
  void store.load(false)
}
</script>

<template>
  <button class="bell-btn" :aria-label="t('notifications.bell')" @click="toggleDrawer">
    <v-icon icon="mdi-bell-outline" size="21" />
    <span v-if="unreadCount > 0" class="bell-btn__badge">{{ badgeText }}</span>
  </button>
</template>

<style scoped>
.bell-btn {
  position: relative;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  border: 0;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.72);
  cursor: pointer;
  transition: background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.bell-btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.bell-btn__badge {
  position: absolute;
  top: 3px;
  right: 3px;
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 0.6rem;
  font-weight: 800;
  line-height: 1;
  color: #fff;
  background: rgb(var(--v-theme-error));
}
</style>
