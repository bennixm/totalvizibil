<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useDisplay } from 'vuetify'

import AppBar from '@/components/AppBar.vue'
import AppFooter from '@/components/AppFooter.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import AppToasts from '@/components/AppToasts.vue'
import MobileTabBar from '@/components/MobileTabBar.vue'
import SidebarModeSwitch from '@/components/SidebarModeSwitch.vue'
import { useLocaleSync } from '@/composables/useLocaleSync'
import { useSignOut } from '@/composables/useSignOut'
import { useThemeSync } from '@/composables/useThemeSync'
import { useUserNavGroups } from '@/composables/useUserNavGroups'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'

// Keep Vuetify theme + i18n locale in sync with the persisted preferences store.
useThemeSync()
useLocaleSync()

const { mdAndUp } = useDisplay()
const route = useRoute()
const auth = useAuthStore()
const ui = useUiStore()
const { groups: userNavGroups } = useUserNavGroups()
const { signOut } = useSignOut()

// Only the "signed-in workspace" routes (dashboard, wallet, leads…) get the
// left sidebar — public/marketing pages and the full-screen create/builder
// flows stay chrome-light. Docked open on desktop, closed by default on
// mobile (the AppBar hamburger toggles it there).
const showPanel = computed(() => Boolean(route.meta.panel) && auth.isAuthenticated)
// Admin has its own nested sidebar (AdminLayout.vue) sharing the same
// `ui.sidebarOpen` store, so the hamburger here also drives it on mobile.
const showMenuToggle = computed(
  () => (showPanel.value || route.path.startsWith('/admin')) && !mdAndUp.value,
)
watch(mdAndUp, (v) => { ui.sidebarOpen = v }, { immediate: true })
</script>

<template>
  <v-app>
    <AppBar :show-menu-toggle="showMenuToggle" @toggle-menu="ui.toggleSidebar" />

    <v-main class="shell" :class="{ 'shell--mobile': !mdAndUp }">
      <v-layout v-if="showPanel" class="panel-layout">
        <AppSidebar :groups="userNavGroups">
          <template v-if="auth.isPlatformStaff" #top>
            <SidebarModeSwitch />
          </template>
          <template #footer>
            <RouterLink :to="{ name: 'account' }" class="sfoot__row">
              <v-icon icon="mdi-account-cog-outline" size="17" />
              {{ $t('nav.account') }}
            </RouterLink>
            <button type="button" class="sfoot__row sfoot__row--danger" @click="signOut">
              <v-icon icon="mdi-logout" size="17" />
              {{ $t('account.signOut') }}
            </button>
          </template>
        </AppSidebar>
        <v-main class="panel-content">
          <router-view />
        </v-main>
      </v-layout>
      <router-view v-else />
    </v-main>

    <AppFooter v-if="mdAndUp" />
    <MobileTabBar v-else />

    <AppToasts />
  </v-app>
</template>

<style scoped>
/* Clear the fixed mobile tab bar so page content is never hidden behind it. */
.shell--mobile {
  padding-bottom: calc(var(--tvz-tabbar-h) + env(safe-area-inset-bottom, 0px) + 12px);
}
.panel-layout {
  min-height: 100%;
}
.panel-content {
  min-width: 0;
}

.sfoot__row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  padding: 0.55rem 0.7rem;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.68);
  text-decoration: none;
  font-size: 0.86rem;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background var(--tvz-dur-fast) var(--tvz-ease-out), color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.sfoot__row:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgb(var(--v-theme-on-surface));
}
.sfoot__row--danger {
  color: rgb(var(--v-theme-error));
}
.sfoot__row--danger:hover {
  background: rgba(var(--v-theme-error), 0.08);
}
</style>
