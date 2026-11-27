<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import { WORKSPACES, type WorkspaceId } from '@/lib/workspaces'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * First switch of the sidebar: WHICH AREA you are in (sites, Google Ads,
 * administration). The second one (SidebarCampaignSwitch) picks the item
 * inside that area, so the two never mix products.
 */
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const auth = useAuthStore()
const workspace = useWorkspaceStore()
const { mdAndUp } = useDisplay()

const menuOpen = ref(false)
type ZoneId = WorkspaceId | 'admin' | 'influencer'
const isAdmin = computed(() => route.path.startsWith('/admin'))
const isInfluencer = computed(() => route.path.startsWith('/influencer'))
const items = computed(() => [
  ...WORKSPACES.map((w) => ({ id: w.id as ZoneId, icon: w.icon, label: t(w.label), hint: t(w.hint) })),
  // Influencer accounts get their own (read-only) area.
  ...(auth.isInfluencer
    ? [
        {
          id: 'influencer' as ZoneId,
          icon: 'mdi-account-star-outline',
          label: t('nav.workspace.influencer'),
          hint: t('nav.workspace.influencerHint'),
        },
      ]
    : []),
  ...(auth.hasReachableStaffArea
    ? [
        {
          id: 'admin' as ZoneId,
          icon: 'mdi-shield-crown-outline',
          label: t('nav.workspace.admin'),
          hint: t('nav.workspace.adminHint'),
        },
      ]
    : []),
])
const activeId = computed<ZoneId>(() =>
  isAdmin.value ? 'admin' : isInfluencer.value ? 'influencer' : workspace.id,
)
const active = computed(() => items.value.find((i) => i.id === activeId.value) ?? items.value[0])

function go(id: ZoneId): void {
  menuOpen.value = false
  if (!mdAndUp.value) ui.closeSidebar()
  // `/admin` by PATH: it is the role-aware dispatch (see the `beforeEach`
  // guard in router/index.ts), so each staff role lands on a page it can open.
  if (id === 'admin') return void router.push({ path: '/admin' })
  if (id === 'influencer') return void router.push({ name: 'influencer' })
  workspace.enter(id)
  void router.push(workspace.current.home)
}
</script>

<template>
  <v-menu v-model="menuOpen" location="bottom start" transition="scale-transition" :close-on-content-click="false">
    <template #activator="{ props }">
      <button v-bind="props" type="button" class="wsw" :class="{ 'is-open': menuOpen }" :aria-label="`${t('nav.workspace.eyebrow')}: ${active.label}`">
        <span class="wsw__ic"><v-icon :icon="active.icon" size="18" /></span>
        <span class="wsw__text">
          <span class="wsw__eyebrow">{{ t('nav.workspace.eyebrow') }}</span>
          <span class="wsw__label">{{ active.label }}</span>
        </span>
        <v-icon icon="mdi-unfold-more-horizontal" size="16" class="wsw__chev" />
      </button>
    </template>

    <v-card class="wsw__menu" rounded="lg">
      <p class="wsw__menuLabel">{{ t('nav.workspace.pick') }}</p>
      <button
        v-for="i in items"
        :key="i.id"
        type="button"
        class="wsw__item"
        :class="{ 'is-active': i.id === activeId }"
        :aria-current="i.id === activeId ? 'true' : undefined"
        @click="go(i.id)"
      >
        <v-icon :icon="i.icon" size="19" />
        <span class="wsw__itemText">
          <b>{{ i.label }}</b>
          <small>{{ i.hint }}</small>
        </span>
        <v-icon v-if="i.id === activeId" icon="mdi-check" size="16" class="wsw__chk" />
      </button>
    </v-card>
  </v-menu>
</template>

<style scoped>
.wsw {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.55rem 0.65rem;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-primary), 0.08);
  cursor: pointer;
  transition: border-color var(--tvz-dur-fast) var(--tvz-ease-out), background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.wsw:hover,
.wsw.is-open {
  background: rgba(var(--v-theme-primary), 0.14);
  border-color: rgba(var(--v-theme-primary), 0.5);
}
.wsw__ic {
  display: grid;
  place-items: center;
  flex: none;
  color: rgb(var(--v-theme-primary));
}
.wsw__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  text-align: left;
}
.wsw__eyebrow {
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.wsw__label {
  font-size: var(--tvz-fs-body);
  font-weight: 700;
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
  width: 17rem;
  max-width: calc(100vw - 2rem);
  padding: 0.35rem;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  box-shadow: var(--tvz-shadow-lg);
}
.wsw__menuLabel {
  margin: 0.3rem 0.6rem 0.4rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.wsw__item {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  width: 100%;
  padding: 0.6rem;
  border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.8);
  text-align: left;
  transition: background 0.14s ease;
}
.wsw__item:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.wsw__item.is-active {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
}
.wsw__itemText {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.wsw__itemText b {
  font-size: var(--tvz-fs-body);
  font-weight: 600;
}
.wsw__itemText small {
  font-size: var(--tvz-fs-caption);
  line-height: 1.3;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.wsw__chk {
  flex: none;
}
</style>
