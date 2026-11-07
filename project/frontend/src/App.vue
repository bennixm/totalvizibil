<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useDisplay } from 'vuetify'

import AppBar from '@/components/AppBar.vue'
import MeshGradientBg from '@/components/background/MeshGradientBg.vue'
import AppFooter from '@/components/AppFooter.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import AppToasts from '@/components/AppToasts.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import MobileTabBar from '@/components/MobileTabBar.vue'
import NotificationDrawer from '@/components/NotificationDrawer.vue'
import SidebarCampaignSwitch from '@/components/SidebarCampaignSwitch.vue'
import SidebarModeSwitch from '@/components/SidebarModeSwitch.vue'
import { useAdminNavGroups } from '@/composables/useAdminNavGroups'
import { useLocaleSync } from '@/composables/useLocaleSync'
import { usePublicNavGroups } from '@/composables/usePublicNavGroups'
import { useSignOut } from '@/composables/useSignOut'
import { useThemeSync } from '@/composables/useThemeSync'
import { useUserNavGroups } from '@/composables/useUserNavGroups'
import { useAuthStore } from '@/stores/auth'
import { usePreferencesStore } from '@/stores/preferences'
import { useUiStore } from '@/stores/ui'

// Keep Vuetify theme + i18n locale in sync with the persisted preferences store.
useThemeSync()
useLocaleSync()

const { mdAndUp } = useDisplay()
const route = useRoute()
const auth = useAuthStore()
const ui = useUiStore()
const prefs = usePreferencesStore()
const { groups: userNavGroups } = useUserNavGroups()
const { groups: adminNavGroups } = useAdminNavGroups()
const { groups: publicNavGroups } = usePublicNavGroups()
const { signOut } = useSignOut()

// One persistent sidebar for the whole signed-in app, admin included — it
// never unmounts when moving between "your workspace" and "admin", only its
// `groups` content swaps. Two separate AppSidebar instances (one per area)
// used to cause a visible flash of the old sidebar while the new route
// chunk loaded; a single instance patches in place instead.
const isAdminRoute = computed(() => route.path.startsWith('/admin'))
// The desktop sidebar: a real column next to the page, only where it always
// was (the business panel, or anywhere under /admin).
const showFullSidebar = computed(
  () => (Boolean(route.meta.panel) && auth.isAuthenticated) || isAdminRoute.value,
)
// On a phone there's no room for a permanent column, so this instead decides
// whether the SLIDING drawer exists at all. It used to inherit
// `showFullSidebar`'s condition exactly — a visitor who wasn't signed in (or
// was, but on a non-panel page like /support or /account) got no drawer and
// no menu button at all: just whatever fit in the navbar's own cramped
// single row. The drawer is temporary/overlay on mobile either way, so
// making it always available there costs nothing while it's closed.
const showSidebar = computed(() => showFullSidebar.value || !mdAndUp.value)
const sidebarGroups = computed(() => {
  if (isAdminRoute.value) return adminNavGroups.value
  if (auth.isAuthenticated) return userNavGroups.value
  return publicNavGroups.value
})
const showMenuToggle = computed(() => showSidebar.value && !mdAndUp.value)
watch(mdAndUp, (v) => { ui.sidebarOpen = v }, { immediate: true })
</script>

<template>
  <v-app>
    <AppBar :show-menu-toggle="showMenuToggle" @toggle-menu="ui.toggleSidebar" />
    <NotificationDrawer v-if="auth.isAuthenticated" />

    <v-main class="shell" :class="{ 'shell--mobile': !mdAndUp }">
      <!-- App-wide ambient background (panel and public pages alike) — opt-
           out via the "Fundal animat" toggle (AppBar top-left, AppFooter)
           for users on weaker hardware; see MeshGradientBg.vue for the perf
           guards (capped DPR, prefers-reduced-motion, silent no-op when
           WebGL2 is unavailable). -->
      <MeshGradientBg v-if="prefs.bgEffectEnabled" />
      <v-layout v-if="showSidebar" class="panel-layout">
        <AppSidebar :groups="sidebarGroups">
          <!-- `hasReachableStaffArea`, not `isPlatformStaff`: the latter is
               true for ANY platform role, so a `moderator`-only account was
               shown an "Admin" switch leading to a page that rejects it. -->
          <!-- `hasReachableStaffArea`, not `isPlatformStaff` (see above) —
               and now also gated on being signed in at all: the mobile
               drawer reaches this same slot for a logged-out visitor too
               (see `showSidebar`), and both switches below render nothing
               meaningful without an account, which used to leave an empty,
               oddly-spaced wrapper div above the nav links. -->
          <template v-if="auth.isAuthenticated && (auth.hasReachableStaffArea || !isAdminRoute)" #top>
            <SidebarModeSwitch v-if="auth.hasReachableStaffArea" />
            <SidebarCampaignSwitch v-if="!isAdminRoute" />
          </template>
          <template #footer>
            <template v-if="auth.isAuthenticated">
              <RouterLink :to="{ name: 'account' }" class="sfoot__row">
                <v-icon icon="mdi-account-cog-outline" size="17" />
                {{ $t('nav.account') }}
              </RouterLink>
              <button type="button" class="sfoot__row sfoot__row--danger" @click="signOut">
                <v-icon icon="mdi-logout" size="17" />
                {{ $t('account.signOut') }}
              </button>
            </template>
            <RouterLink v-else :to="{ name: 'login' }" class="sfoot__row">
              <v-icon icon="mdi-login-variant" size="17" />
              {{ $t('nav.login') }}
            </RouterLink>
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
    <ConfirmDialog />
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
/* Vuetify's v-layout clips overflow by default, which silently breaks
   `position: sticky` on the sidebar inside it (sticky needs every ancestor
   up to the real scrolling context to allow overflow) — only relevant at
   the desktop breakpoint where the sidebar is sticky in the first place. */
@media (min-width: 960px) {
  .panel-layout {
    overflow: visible !important;
    /* Same 90%-of-viewport width as the navbar/footer content (AppBar.vue's
       `.topbar_content`, AppFooter.vue's `.tvz-footer__inner`), so the whole
       sidebar+content section lines up with them instead of running edge to
       edge. The sidebar's own `left: 0` (Vuetify inline style) is relative
       to this element once it's the positioned ancestor, so centering it
       here moves the sidebar along with it, not just the content pane. */
    width: 90%;
    margin-inline: auto;
  }
  .panel-content {
    /* Vuetify still applies its own padding-left (from --v-layout-left,
       248px) on top of this — a holdover from when the sidebar was
       `position: absolute` and needed the content manually offset to avoid
       an overlap. Now that it's `sticky` (in normal flow), the flex row
       already places .panel-content right after it, so that padding just
       doubles the gap. Zero it out and use a plain margin for the gap
       instead — a single, obvious number instead of two reserves stacked. */
    padding-left: 0 !important;
    margin-left: 24px;
  }
}
.panel-content {
  min-width: 0;
}
/* Every panel page sets its own root width (.dash, .wal, .txn, …) — override
   them all to one shared width instead of each page picking its own, using
   the router-view's rendered root as a wildcard so this doesn't need
   touching every view file individually. */
.panel-content > :deep(*) {
  max-width: 1020px !important;
  margin-inline: auto !important;
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
