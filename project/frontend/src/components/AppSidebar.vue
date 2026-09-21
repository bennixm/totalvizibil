<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { useDisplay } from 'vuetify'

import { useUiStore } from '@/stores/ui'

export interface SidebarNavItem {
  to: RouteLocationRaw
  label: string
  icon: string
  badge?: string | number
  /** Route names (besides the exact match) that should also light this item up. */
  activeMatch?: string[]
}
export interface SidebarNavGroup {
  label?: string
  items: SidebarNavItem[]
}

defineProps<{
  groups: SidebarNavGroup[]
  brandIcon?: string
  brandLabel?: string
  brandTo?: RouteLocationRaw
}>()

const { mdAndUp } = useDisplay()
const ui = useUiStore()

function onNavigate(): void {
  if (!mdAndUp.value) ui.closeSidebar()
}
</script>

<template>
  <v-navigation-drawer
    v-model="ui.sidebarOpen"
    :permanent="mdAndUp"
    :temporary="!mdAndUp"
    width="248"
    :elevation="0"
    class="app-sidebar"
  >
    <div class="sbar">
      <RouterLink v-if="brandLabel" :to="brandTo ?? { name: 'feed' }" class="sbar__brand" @click="onNavigate">
        <span class="sbar__brand-mark"><v-icon :icon="brandIcon ?? 'mdi-compass-outline'" size="18" /></span>
        <span class="sbar__brand-word">{{ brandLabel }}</span>
      </RouterLink>

      <div v-if="$slots.top" class="sbar__top">
        <slot name="top" />
      </div>

      <nav class="sbar__nav">
        <div v-for="(g, gi) in groups" :key="g.label ?? gi" class="sbar__group">
          <span v-if="g.label" class="sbar__group-label">{{ g.label }}</span>
          <RouterLink
            v-for="item in g.items"
            :key="item.label"
            :to="item.to"
            class="sbar__link"
            @click="onNavigate"
          >
            <v-icon :icon="item.icon" size="19" />
            <span class="sbar__link-label">{{ item.label }}</span>
            <span v-if="item.badge" class="sbar__badge">{{ item.badge }}</span>
          </RouterLink>
        </div>
      </nav>

      <div v-if="$slots.footer" class="sbar__footer">
        <slot name="footer" />
      </div>
    </div>
  </v-navigation-drawer>
</template>

<style scoped>
.app-sidebar {
  background: rgb(var(--v-theme-surface)) !important;
  border-right: 1px solid var(--tvz-hairline) !important;
}
.sbar {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 1.1rem 0.85rem 1rem;
  gap: 1.3rem;
}

.sbar__brand {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  text-decoration: none;
  color: rgb(var(--v-theme-on-surface));
  padding-inline: 0.35rem;
}
.sbar__brand-mark {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: 9px;
  color: #fff;
  background: var(--tvz-gradient-brand);
}
.sbar__brand-word {
  font-family: 'Space Grotesk Variable', 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 0.94rem;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sbar__top {
  flex: none;
}

.sbar__nav {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1.15rem;
}
.sbar__group {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.sbar__group-label {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgba(var(--v-theme-on-surface), 0.42);
  padding: 0 0.7rem 0.35rem;
}
.sbar__link {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.58rem 0.7rem;
  border-radius: 10px;
  color: rgba(var(--v-theme-on-surface), 0.68);
  text-decoration: none;
  font-size: 0.89rem;
  font-weight: 500;
  transition: background var(--tvz-dur-fast) var(--tvz-ease-out), color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.sbar__link:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgb(var(--v-theme-on-surface));
}
.sbar__link.router-link-active {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}
.sbar__link-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sbar__badge {
  flex: none;
  min-width: 1.2rem;
  padding: 0.05rem 0.35rem;
  text-align: center;
  font-size: 0.68rem;
  font-weight: 700;
  border-radius: 999px;
  background: rgba(var(--v-theme-primary), 0.16);
  color: rgb(var(--v-theme-primary));
}

.sbar__footer {
  border-top: 1px solid var(--tvz-hairline);
  padding-top: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
</style>
