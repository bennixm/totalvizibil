<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import { useUiStore } from '@/stores/ui'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const { mdAndUp } = useDisplay()

const isAdmin = computed(() => route.path.startsWith('/admin'))

function go(target: 'user' | 'admin'): void {
  if (!mdAndUp.value) ui.closeSidebar()
  void router.push(target === 'admin' ? { name: 'admin-dashboard' } : { name: 'dashboard' })
}
</script>

<template>
  <div class="sms" role="tablist" :aria-label="t('nav.modeSwitch')">
    <button
      type="button"
      role="tab"
      class="sms__seg"
      :class="{ 'is-active': !isAdmin }"
      :aria-selected="!isAdmin"
      @click="go('user')"
    >
      <v-icon icon="mdi-view-dashboard-outline" size="15" />
      {{ t('nav.modeUser') }}
    </button>
    <button
      type="button"
      role="tab"
      class="sms__seg"
      :class="{ 'is-active': isAdmin }"
      :aria-selected="isAdmin"
      @click="go('admin')"
    >
      <v-icon icon="mdi-shield-crown-outline" size="15" />
      {{ t('nav.modeAdmin') }}
    </button>
  </div>
</template>

<style scoped>
.sms {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.2rem;
  padding: 0.2rem;
  border-radius: 11px;
  background: rgba(var(--v-theme-on-surface), 0.055);
}
.sms__seg {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  padding: 0.4rem 0.3rem;
  border-radius: 8px;
  border: 0;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.74rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  transition:
    background var(--tvz-dur-fast) var(--tvz-ease-out),
    color var(--tvz-dur-fast) var(--tvz-ease-out),
    box-shadow var(--tvz-dur-fast) var(--tvz-ease-out);
}
.sms__seg :deep(.v-icon) {
  flex: none;
}
.sms__seg:hover {
  color: rgb(var(--v-theme-on-surface));
}
.sms__seg.is-active {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-primary));
  box-shadow: var(--tvz-shadow-sm);
}
</style>
