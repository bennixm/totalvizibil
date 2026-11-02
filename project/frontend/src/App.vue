<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useDisplay } from 'vuetify'

import AppBar from '@/components/AppBar.vue'
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
const { groups: adminNavGroups } = useAdminNavGroups()
const { signOut } = useSignOut()

// One persistent sidebar for the whole signed-in app, admin included — it
// never unmounts when moving between "your workspace" and "admin", only its
// `groups` content swaps. Two separate AppSidebar instances (one per area)
// used to cause a visible flash of the old sidebar while the new route
// chunk loaded; a single instance patches in place instead.
const isAdminRoute = computed(() => route.path.startsWith('/admin'))
const showSidebar = computed(
  () => (Boolean(route.meta.panel) && auth.isAuthenticated) || isAdminRoute.value,
)
const sidebarGroups = computed(() => (isAdminRoute.value ? adminNavGroups.value : userNavGroups.value))
const showMenuToggle = computed(() => showSidebar.value && !mdAndUp.value)
watch(mdAndUp, (v) => { ui.sidebarOpen = v }, { immediate: true })
</script>

<template>
  <v-app>
    <AppBar :show-menu-toggle="showMenuToggle" @toggle-menu="ui.toggleSidebar" />
    <NotificationDrawer v-if="auth.isAuthenticated" />

    <v-main class="shell" :class="{ 'shell--mobile': !mdAndUp }">
      <!-- Ambient light behind the panel only — never the public/marketing
           pages. Three blurred blobs drifting via `transform` (GPU-
           composited, cheap) so the glass sections sitting on top (.dcard,
           AdminSection's .asec, .ana__hero/__chart — see tokens.scss
           --tvz-glass-*) have something alive to show through. -->
      <div v-if="showSidebar" class="shell__glow" aria-hidden="true">
        <span class="shell__blob shell__blob--a" />
        <span class="shell__blob shell__blob--b" />
        <span class="shell__blob shell__blob--c" />
      </div>
      <v-layout v-if="showSidebar" class="panel-layout">
        <AppSidebar :groups="sidebarGroups">
          <!-- `hasReachableStaffArea`, not `isPlatformStaff`: the latter is
               true for ANY platform role, so a `moderator`-only account was
               shown an "Admin" switch leading to a page that rejects it. -->
          <template v-if="auth.hasReachableStaffArea || !isAdminRoute" #top>
            <SidebarModeSwitch v-if="auth.hasReachableStaffArea" />
            <SidebarCampaignSwitch v-if="!isAdminRoute" />
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
    <ConfirmDialog />
  </v-app>
</template>

<style scoped>
.shell__glow {
  position: fixed;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}
.shell__blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(64px);
  opacity: var(--tvz-glow-opacity, 0.2);
  will-change: transform;
}
/* Dark ground: additive "light" blending instead of flat alpha compositing —
   plus-lighter accumulates brightness like a real light source instead of
   painting a flat tinted disc over near-black, which reads as more natural
   AND hides the banding plain alpha-over-dark made visible as "pixelation". */
.v-theme--dark .shell__blob {
  mix-blend-mode: plus-lighter;
}
.shell__blob--a {
  width: clamp(260px, 42vw, 560px);
  height: clamp(260px, 42vw, 560px);
  top: -12%;
  left: -8%;
  background: radial-gradient(
    circle,
    var(--tvz-brand-3) 0%,
    color-mix(in srgb, var(--tvz-brand-3) 45%, transparent) 38%,
    transparent 70%
  );
  animation: shellDriftA 42s var(--tvz-ease-out) infinite alternate;
}
.shell__blob--b {
  width: clamp(220px, 34vw, 480px);
  height: clamp(220px, 34vw, 480px);
  bottom: -14%;
  right: -6%;
  background: radial-gradient(
    circle,
    var(--tvz-brand-1) 0%,
    color-mix(in srgb, var(--tvz-brand-1) 45%, transparent) 38%,
    transparent 70%
  );
  animation: shellDriftB 50s var(--tvz-ease-out) infinite alternate;
}
.shell__blob--c {
  width: clamp(180px, 28vw, 400px);
  height: clamp(180px, 28vw, 400px);
  top: 36%;
  left: 58%;
  background: radial-gradient(
    circle,
    var(--tvz-brand-3) 0%,
    color-mix(in srgb, var(--tvz-brand-3) 45%, transparent) 38%,
    transparent 70%
  );
  animation: shellDriftC 58s var(--tvz-ease-out) infinite alternate;
}
@keyframes shellDriftA {
  from {
    transform: translate(0, 0) scale(1);
  }
  to {
    transform: translate(7vw, 9vh) scale(1.12);
  }
}
@keyframes shellDriftB {
  from {
    transform: translate(0, 0) scale(1);
  }
  to {
    transform: translate(-8vw, -6vh) scale(1.08);
  }
}
@keyframes shellDriftC {
  from {
    transform: translate(0, 0) scale(1);
  }
  to {
    transform: translate(-5vw, 6vh) scale(0.94);
  }
}
@media (prefers-reduced-motion: reduce) {
  .shell__blob {
    animation: none;
  }
}

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
