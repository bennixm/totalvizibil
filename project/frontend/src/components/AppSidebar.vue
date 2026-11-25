<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import { useDisplay } from 'vuetify'

import BgEffectQuickToggle from '@/components/BgEffectQuickToggle.vue'
import CurrencyQuickToggle from '@/components/CurrencyQuickToggle.vue'
import LocaleSwitcher from '@/components/LocaleSwitcher.vue'
import ThemeQuickToggle from '@/components/ThemeQuickToggle.vue'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'

export interface SidebarNavItem {
  to: RouteLocationRaw
  label: string
  icon: string
  badge?: string | number
  /** Route names (besides the exact match) that should also light this item up. */
  activeMatch?: string[]
  /** For sections of ONE page selected by `?tab=` (the Google Ads campaign
   *  dashboard): lit only when that tab is the current one (`default` also
   *  matches no `?tab`), since `router-link-active` ignores the query. */
  tab?: { value: string; default?: boolean; route?: string }
}
export interface SidebarNavGroup {
  label?: string
  /** Set to make the group foldable (its state is remembered per browser). */
  id?: string
  /** Folded until opened, unless the current page is in it. */
  startFolded?: boolean
  items: SidebarNavItem[]
}

const props = defineProps<{
  groups: SidebarNavGroup[]
  brandIcon?: string
  brandLabel?: string
  brandTo?: RouteLocationRaw
}>()

const { mdAndUp } = useDisplay()
const route = useRoute()
function tabActive(item: SidebarNavItem): boolean {
  if (!item.tab) return item.activeMatch?.includes(String(route.name)) ?? false
  if (item.tab.route && route.name !== item.tab.route) return false
  const q = typeof route.query.tab === 'string' ? route.query.tab : null
  return q === item.tab.value || (!q && !!item.tab.default)
}
const ui = useUiStore()
const auth = useAuthStore()

const router = useRouter()
const FOLD_KEY = 'tvz.navFold.v1'
function readFolds(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(FOLD_KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}
/** Group id -> open, only for the groups the user toggled. */
const folds = ref(readFolds())
const total = computed(() => props.groups.reduce((s, g) => s + g.items.length, 0))
function hasCurrent(g: SidebarNavGroup): boolean {
  return g.items.some(
    (i) => router.resolve(i.to).name === route.name || i.activeMatch?.includes(String(route.name)),
  )
}
function isOpen(g: SidebarNavGroup): boolean {
  if (!g.id || hasCurrent(g)) return true
  // Inside the one long group, the others fold too, so every heading fits.
  const longOpen = props.groups.some((x) => x.startFolded && hasCurrent(x))
  return folds.value[g.id] ?? (total.value <= 10 || (!g.startFolded && !longOpen))
}
function toggleGroup(g: SidebarNavGroup): void {
  if (!g.id) return
  folds.value = { ...folds.value, [g.id]: !isOpen(g) }
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify(folds.value))
  } catch {
    /* storage unavailable: kept for this page view */
  }
}

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

      <nav class="sbar__nav" :class="{ 'sbar__nav--dense': total > 10 }">
        <div v-for="(g, gi) in groups" :key="g.label ?? gi" class="sbar__group">
          <button
            v-if="g.label && g.id"
            type="button"
            class="sbar__group-label sbar__group-label--btn"
            :aria-expanded="isOpen(g)"
            @click="toggleGroup(g)"
          >
            {{ g.label }}
            <v-icon v-if="!hasCurrent(g)" :icon="isOpen(g) ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="15" />
          </button>
          <span v-else-if="g.label" class="sbar__group-label">{{ g.label }}</span>
          <RouterLink
            v-for="item in isOpen(g) ? g.items : []"
            :key="item.label"
            :to="item.to"
            class="sbar__link"
            :class="{ 'router-link-active': tabActive(item) }"
            :active-class="item.tab ? 'sbar__link--path' : undefined"
            :exact-active-class="item.tab ? 'sbar__link--path' : undefined"
            @click="onNavigate"
          >
            <v-icon :icon="item.icon" size="19" />
            <span class="sbar__link-label">{{ item.label }}</span>
            <span v-if="item.badge" class="sbar__badge">{{ item.badge }}</span>
          </RouterLink>
        </div>
      </nav>

      <!-- Mobile only: the navbar's own quiet utility strip (currency,
           theme, animated-background, locale) has no room left once the
           drawer takes over as the primary mobile nav — tucked in here,
           below the real nav links and above sign-out, instead of eating
           into the top bar's height on every single mobile page. Desktop
           keeps them in AppBar's upper row (a permanent sidebar right next
           to it would just duplicate them). -->
      <div v-if="!mdAndUp" class="sbar__quick">
        <CurrencyQuickToggle v-if="auth.isAuthenticated" compact />
        <ThemeQuickToggle />
        <BgEffectQuickToggle />
        <LocaleSwitcher compact />
      </div>

      <div v-if="$slots.footer" class="sbar__footer">
        <slot name="footer" />
      </div>
    </div>
  </v-navigation-drawer>
</template>

<style scoped>
.app-sidebar {
  background: rgb(var(--v-theme-surface)) !important;
  /* .panel-layout is a flex row — without this, narrowing it (see App.vue's
     `width: 90%`) let the flex algorithm shrink the sidebar itself below
     its declared 248px instead of only ever shrinking the content pane. */
  flex: none !important;
}
/* On desktop this drawer sits nested inside a secondary v-layout (for the
   two-level admin/panel nav), which registers it as `position: absolute`
   against that layout's own content height — so it scrolls away with the
   page instead of staying put. `sticky` (not `fixed`) is the fix: fixed
   pins it to the viewport unconditionally, which kept it floating over
   the footer even after scrolling past the whole panel section into
   content that lives outside `.panel-layout` entirely. Sticky naturally
   releases once its containing block's bottom edge is reached, so it
   only ever covers the panel area it belongs to. Mobile's `temporary`
   variant already overlays the viewport by itself, so this only needs to
   apply at the `mdAndUp` breakpoint the `:permanent` prop switches on. */
@media (min-width: 960px) {
  .app-sidebar {
    position: sticky !important;
    top: calc(var(--tvz-topbar-h) + 10px) !important;
    bottom: auto !important;
    height: calc(100dvh - var(--tvz-topbar-h) - 10px) !important;
    /* Beside the page now, with a gap (see .panel-content in App.vue) —
       no boxed panel look, just nav floating on the page's own background.
       Mobile's temporary overlay keeps its opaque surface above, unrelated. */
    background: transparent !important;
  }
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
  font-size: var(--tvz-fs-section);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sbar__top {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.sbar__nav {
  /* No flex-grow: sized by its own content, so the footer sits right below
     the last nav item instead of being pushed to the bottom of a much
     taller sidebar. Shrinks (and scrolls internally, on its OWN scrollbar —
     not the whole drawer's) if the nav list is ever taller than the
     available height — but only down to `min-height` below, never further:
     on a short phone screen, `.sbar__top`/`.sbar__quick`/`.sbar__footer`
     (none of which shrink — they're all `flex: none`) used to be able to
     squeeze this down to a sliver, sometimes 0, so the actual page links
     were the first thing to disappear instead of the last. This floor
     guarantees a handful of links stay visible+scrollable no matter what;
     if the drawer genuinely can't fit everything even at the floor,
     Vuetify's own `.v-navigation-drawer__content` wrapper (already
     `overflow-y: auto`) scrolls the whole sidebar as the fallback. */
  flex: 0 1 auto;
  min-height: 200px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1.15rem;
}
/* Long menus: everything stays visible on a laptop screen. */
.sbar__nav--dense {
  gap: 0.6rem;
}
.sbar__nav--dense .sbar__group + .sbar__group {
  padding-top: 0.6rem;
}
.sbar__nav--dense .sbar__link {
  padding-block: 0.36rem;
}
.sbar__group {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
/* A visual break between groups (e.g. business/campaign pages vs. general
   account pages) — content-driven, so it only ever appears between actual
   groups, never before the first one. */
.sbar__group + .sbar__group {
  padding-top: 1rem;
  border-top: 1px solid var(--tvz-hairline);
}
.sbar__group-label {
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgba(var(--v-theme-on-surface), 0.42);
  padding: 0 0.7rem 0.35rem;
}
.sbar__group-label--btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 26px;
  text-align: left;
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
  font-size: var(--tvz-fs-body);
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
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  border-radius: 0;
  clip-path: var(--tvz-hex-xs);
  background: rgba(var(--v-theme-primary), 0.16);
  color: rgb(var(--v-theme-primary));
}

.sbar__quick {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--tvz-hairline);
}
/* Same resting affordance AppBar's own upper strip gives these (a quiet
   background so an unstyled text/icon button doesn't read as a loose
   label floating in the drawer) — duplicated rather than shared because
   that strip is scoped to AppBar.vue and teleported menus (Currency/
   Locale's own v-menu) escape a plain parent selector anyway. */
.sbar__quick :deep(.v-btn) {
  background: rgba(var(--v-theme-on-surface), 0.055);
  border-radius: 8px;
}
.sbar__quick :deep(.v-btn--icon) {
  width: 28px;
  height: 28px;
}

.sbar__footer {
  border-top: 1px solid var(--tvz-hairline);
  padding-top: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
</style>
