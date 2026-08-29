<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const route = useRoute()
const auth = useAuthStore()

type Tab = {
  key: string
  label: string
  icon: string
  activeIcon: string
  to: { name: string }
  match: string[]
  center?: boolean
}

const tabs = computed<Tab[]>(() => {
  const create: Tab = {
    key: 'create',
    label: t('nav.create'),
    icon: 'mdi-plus',
    activeIcon: 'mdi-plus',
    to: { name: 'create' },
    match: ['create'],
    center: true,
  }
  const discover: Tab = {
    key: 'discover',
    label: t('nav.discover'),
    icon: 'mdi-compass-outline',
    activeIcon: 'mdi-compass',
    to: { name: 'feed' },
    match: ['feed', 'company'],
  }
  const last: Tab = auth.isAuthenticated
    ? {
        key: 'account',
        label: t('nav.account'),
        icon: 'mdi-account-cog-outline',
        activeIcon: 'mdi-account-cog',
        to: { name: 'account' },
        match: ['account', 'admin'],
      }
    : {
        key: 'signin',
        label: t('nav.login'),
        icon: 'mdi-account-circle-outline',
        activeIcon: 'mdi-account-circle',
        to: { name: 'login' },
        match: ['login'],
      }
  return [discover, create, last]
})

function isActive(tab: Tab): boolean {
  return tab.match.includes(String(route.name))
}
</script>

<template>
  <nav class="tabbar" role="navigation" :aria-label="t('nav.discover')">
    <router-link
      v-for="tab in tabs"
      :key="tab.key"
      :to="tab.to"
      class="tab"
      :class="{ 'tab--active': isActive(tab), 'tab--center': tab.center }"
    >
      <span class="tab__icon">
        <v-icon :icon="isActive(tab) ? tab.activeIcon : tab.icon" :size="tab.center ? 24 : 22" />
      </span>
      <span class="tab__label">{{ tab.label }}</span>
    </router-link>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  align-items: center;
  height: calc(var(--tvz-tabbar-h) + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: var(--tvz-glass-bg-strong);
  backdrop-filter: blur(18px) saturate(1.6);
  -webkit-backdrop-filter: blur(18px) saturate(1.6);
  border-top: 1px solid var(--tvz-hairline);
}

.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  padding: 0.4rem 0.25rem;
  text-decoration: none;
  color: rgb(var(--v-theme-on-surface) / 0.55);
  transition: color var(--tvz-dur-fast) var(--tvz-ease-out);
  -webkit-tap-highlight-color: transparent;
}
.tab--active {
  color: rgb(var(--v-theme-primary));
}
.tab__icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 30px;
  border-radius: 999px;
  transition:
    background var(--tvz-dur-med) var(--tvz-ease-out),
    transform var(--tvz-dur-med) var(--tvz-ease-spring);
}
.tab--active .tab__icon {
  background: rgb(var(--v-theme-primary) / 0.14);
}
.tab__label {
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  max-width: 8ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Center "Create" — raised primary action, app-style */
.tab--center {
  color: #fff;
}
.tab--center .tab__icon {
  width: 52px;
  height: 52px;
  margin-top: -22px;
  background: var(--tvz-gradient-brand);
  color: #fff;
  box-shadow:
    0 6px 18px rgba(var(--v-theme-primary), 0.4),
    0 0 0 5px rgb(var(--v-theme-surface));
}
.tab--center.tab--active .tab__icon {
  background: var(--tvz-gradient-brand);
  transform: translateY(-1px) scale(1.03);
}
.tab--center .tab__label {
  color: rgb(var(--v-theme-on-surface) / 0.7);
  margin-top: 0.1rem;
}

@media (prefers-reduced-motion: reduce) {
  .tab__icon {
    transition: none;
  }
}
</style>
