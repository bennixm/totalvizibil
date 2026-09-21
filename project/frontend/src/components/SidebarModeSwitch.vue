<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import { useUiStore } from '@/stores/ui'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const { mdAndUp } = useDisplay()

const menuOpen = ref(false)
const isAdmin = computed(() => route.path.startsWith('/admin'))
const currentIcon = computed(() => (isAdmin.value ? 'mdi-shield-crown-outline' : 'mdi-view-dashboard-outline'))
const currentLabel = computed(() => (isAdmin.value ? t('nav.modeAdmin') : t('nav.modeUser')))

function go(target: 'user' | 'admin'): void {
  menuOpen.value = false
  if (!mdAndUp.value) ui.closeSidebar()
  void router.push(target === 'admin' ? { name: 'admin-dashboard' } : { name: 'dashboard' })
}
</script>

<template>
  <v-menu v-model="menuOpen" location="bottom start" transition="scale-transition" :close-on-content-click="false">
    <template #activator="{ props }">
      <button v-bind="props" type="button" class="wsw" :class="{ 'is-open': menuOpen }">
        <span class="wsw__ic"><v-icon :icon="currentIcon" size="16" /></span>
        <span class="wsw__label">{{ currentLabel }}</span>
        <v-icon icon="mdi-unfold-more-horizontal" size="16" class="wsw__chev" />
      </button>
    </template>

    <v-card class="wsw__menu" rounded="lg">
      <button type="button" class="wsw__item" :class="{ 'is-active': !isAdmin }" @click="go('user')">
        <v-icon icon="mdi-view-dashboard-outline" size="17" />
        <span>{{ t('nav.modeUser') }}</span>
        <v-icon v-if="!isAdmin" icon="mdi-check" size="15" class="wsw__chk" />
      </button>
      <button type="button" class="wsw__item" :class="{ 'is-active': isAdmin }" @click="go('admin')">
        <v-icon icon="mdi-shield-crown-outline" size="17" />
        <span>{{ t('nav.modeAdmin') }}</span>
        <v-icon v-if="isAdmin" icon="mdi-check" size="15" class="wsw__chk" />
      </button>
    </v-card>
  </v-menu>
</template>

<style scoped>
.wsw {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  padding: 0.5rem 0.65rem;
  border-radius: 10px;
  border: 1px solid var(--tvz-hairline);
  background: rgb(var(--v-theme-surface));
  cursor: pointer;
  transition: border-color var(--tvz-dur-fast) var(--tvz-ease-out), background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.wsw:hover,
.wsw.is-open {
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-color: rgba(var(--v-theme-on-surface), 0.18);
}
.wsw__ic {
  display: grid;
  place-items: center;
  flex: none;
  color: rgb(var(--v-theme-primary));
}
.wsw__label {
  flex: 1;
  min-width: 0;
  text-align: left;
  font-size: 0.84rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wsw__chev {
  flex: none;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
</style>

<style>
/* Teleported overlay content — theme tokens only, same convention as the
   account menu in AppBar.vue. */
.wsw__menu {
  width: 15rem;
  padding: 0.35rem;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  box-shadow: var(--tvz-shadow-lg);
}
.wsw__item {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  padding: 0.55rem 0.6rem;
  border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.75);
  font-size: 0.88rem;
  font-weight: 500;
  text-align: left;
  transition: background 0.14s ease;
}
.wsw__item:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.wsw__item.is-active {
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}
.wsw__item span {
  flex: 1;
}
.wsw__chk {
  flex: none;
  color: rgb(var(--v-theme-primary));
}
</style>
