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
  /* A light touch-up only — the softness now comes mainly from the gradient
     itself (many stops, long fade), not this. A big `filter: blur()` on a
     large element is a known Chromium pixelation trap: the blur gets
     rasterised at reduced internal resolution, and animating `transform:
     scale()` on top of that (the old version did) stretches the already-
     blocky raster further. Analytic gradients don't have that failure mode
     at any size, so that does the real work; this just rounds off the stops. */
  filter: blur(20px);
  opacity: var(--tvz-glow-opacity, 0.2);
  will-change: transform;
}
/* Dark ground: additive "light" blending instead of flat alpha compositing —
   plus-lighter accumulates brightness like a real light source instead of
   painting a flat tinted disc over near-black, which reads as more natural
   and keeps what little rasterisation the blur above still does from
   showing as visible steps. */
.v-theme--dark .shell__blob {
  mix-blend-mode: plus-lighter;
}
.shell__blob--a {
  width: clamp(320px, 48vw, 640px);
  height: clamp(320px, 48vw, 640px);
  top: -16%;
  left: -12%;
  background: radial-gradient(
    circle,
    var(--tvz-brand-3) 0%,
    color-mix(in srgb, var(--tvz-brand-3) 65%, transparent) 10%,
    color-mix(in srgb, var(--tvz-brand-3) 40%, transparent) 24%,
    color-mix(in srgb, var(--tvz-brand-3) 20%, transparent) 42%,
    color-mix(in srgb, var(--tvz-brand-3) 7%, transparent) 62%,
    transparent 85%
  );
  animation: shellDriftA 42s var(--tvz-ease-out) infinite alternate;
}
.shell__blob--b {
  width: clamp(280px, 40vw, 560px);
  height: clamp(280px, 40vw, 560px);
  bottom: -18%;
  right: -10%;
  background: radial-gradient(
    circle,
    var(--tvz-brand-1) 0%,
    color-mix(in srgb, var(--tvz-brand-1) 65%, transparent) 10%,
    color-mix(in srgb, var(--tvz-brand-1) 40%, transparent) 24%,
    color-mix(in srgb, var(--tvz-brand-1) 20%, transparent) 42%,
    color-mix(in srgb, var(--tvz-brand-1) 7%, transparent) 62%,
    transparent 85%
  );
  animation: shellDriftB 50s var(--tvz-ease-out) infinite alternate;
}
.shell__blob--c {
  width: clamp(240px, 34vw, 480px);
  height: clamp(240px, 34vw, 480px);
  top: 34%;
  left: 56%;
  background: radial-gradient(
    circle,
    var(--tvz-brand-3) 0%,
    color-mix(in srgb, var(--tvz-brand-3) 65%, transparent) 10%,
    color-mix(in srgb, var(--tvz-brand-3) 40%, transparent) 24%,
    color-mix(in srgb, var(--tvz-brand-3) 20%, transparent) 42%,
    color-mix(in srgb, var(--tvz-brand-3) 7%, transparent) 62%,
    transparent 85%
  );
  animation: shellDriftC 58s var(--tvz-ease-out) infinite alternate;
}
/* Translate only — no `scale()` — so the animated layer never resamples the
   blurred texture at a different size mid-drift (the other half of the
   pixelation fix above). */
@keyframes shellDriftA {
  from {
    transform: translate(0, 0);
  }
  to {
    transform: translate(6vw, 8vh);
  }
}
@keyframes shellDriftB {
  from {
    transform: translate(0, 0);
  }
  to {
    transform: translate(-7vw, -5vh);
  }
}
@keyframes shellDriftC {
  from {
    transform: translate(0, 0);
  }
  to {
    transform: translate(-4vw, 5vh);
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
