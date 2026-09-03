<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import { useBuilderStore, type PageInput } from '@/stores/builder'

const props = defineProps<{ companyId: string }>()
const emit = defineEmits<{ openCatalog: [payload: { pageId: string; index?: number }] }>()

const { t } = useI18n()
const store = useBuilderStore()
const { pages, activePage, selectedId, working } = storeToRefs(store)

const MAX_PAGES = 6
const renaming = ref<string | null>(null)
const renameText = ref('')

function payload(): PageInput[] {
  return pages.value.map((p) => ({ id: p.id, title: p.title, isHome: p.isHome, nav: p.nav }))
}
function commit(list: PageInput[]): void {
  void store.putPages(props.companyId, list)
}

function addPage(): void {
  if (pages.value.length >= MAX_PAGES) return
  commit([
    ...payload(),
    { title: t('builder.pageN', { n: pages.value.length + 1 }), isHome: false, nav: true },
  ])
}
function startRename(id: string, title: string): void {
  renaming.value = id
  renameText.value = title
}
function saveRename(): void {
  const id = renaming.value
  renaming.value = null
  if (!id) return
  const txt = renameText.value.trim().slice(0, 60)
  commit(payload().map((p) => (p.id === id ? { ...p, title: txt || p.title } : p)))
}
function setHome(id: string): void {
  commit(payload().map((p) => ({ ...p, isHome: p.id === id })))
}
function toggleNav(id: string): void {
  commit(payload().map((p) => (p.id === id ? { ...p, nav: !p.nav } : p)))
}
function deletePage(id: string): void {
  if (pages.value.length <= 1) return
  commit(payload().filter((p) => p.id !== id))
}

// --- section list (active page) ---
const sections = computed(() => activePage.value?.sections ?? [])
const dragIdx = ref<number | null>(null)

function specFor(type: string) {
  return store.catalogByType[type]
}
function secLabel(type: string): string {
  const spec = specFor(type)
  const k = `catalog.${spec?.label ?? type}.label`
  const s = t(k)
  return s === k ? type : s
}
function onDragStart(i: number): void {
  dragIdx.value = i
}
function onDrop(i: number): void {
  const from = dragIdx.value
  dragIdx.value = null
  if (from === null || from === i || !activePage.value) return
  const sec = sections.value[from]
  void store.moveSection(props.companyId, sec.id, activePage.value.id, i)
}
function toggleVisible(id: string, visible: boolean): void {
  store.patchSection(props.companyId, id, { visible: !visible }, { immediate: true })
}
function moveToPage(id: string, pageId: string): void {
  const target = pages.value.find((p) => p.id === pageId)
  if (target) void store.moveSection(props.companyId, id, pageId, target.sections.length)
}
</script>

<template>
  <div class="pp">
    <!-- page tabs -->
    <div class="pp__pages">
      <div
        v-for="p in pages"
        :key="p.id"
        class="pp__tab"
        :class="{ 'is-on': activePage?.id === p.id }"
        @click="store.setActivePage(p.id)"
      >
        <input
          v-if="renaming === p.id"
          v-model="renameText"
          class="pp__rename"
          type="text"
          maxlength="60"
          @keydown.enter="saveRename"
          @blur="saveRename"
          @click.stop
        />
        <button v-else type="button" class="pp__tabName" @dblclick="startRename(p.id, p.title)">
          <v-icon v-if="p.isHome" icon="mdi-home" size="12" />
          {{ p.title }}
          <v-icon v-if="!p.nav" icon="mdi-eye-off-outline" size="12" class="pp__muted" />
        </button>
      </div>
      <button
        v-if="pages.length < MAX_PAGES"
        type="button"
        class="pp__addPage"
        :disabled="working"
        @click="addPage"
      >
        <v-icon icon="mdi-plus" size="16" />
      </button>
    </div>

    <!-- active page controls -->
    <div v-if="activePage" class="pp__pageBar">
      <button type="button" @click="startRename(activePage.id, activePage.title)">
        <v-icon icon="mdi-pencil-outline" size="14" /> {{ t('builder.rename') }}
      </button>
      <button type="button" :disabled="activePage.isHome" @click="setHome(activePage.id)">
        <v-icon icon="mdi-home-outline" size="14" /> {{ t('builder.setHome') }}
      </button>
      <button type="button" @click="toggleNav(activePage.id)">
        <v-icon :icon="activePage.nav ? 'mdi-eye-outline' : 'mdi-eye-off-outline'" size="14" />
        {{ activePage.nav ? t('builder.inNav') : t('builder.notInNav') }}
      </button>
      <button
        type="button"
        class="pp__del"
        :disabled="pages.length <= 1"
        @click="deletePage(activePage.id)"
      >
        <v-icon icon="mdi-trash-can-outline" size="14" />
      </button>
    </div>

    <!-- section list -->
    <div class="pp__list">
      <div
        v-for="(s, i) in sections"
        :key="s.id"
        class="pp__sec"
        :class="{ 'is-sel': selectedId === s.id, 'is-hidden': !s.visible }"
        draggable="true"
        @dragstart="onDragStart(i)"
        @dragover.prevent
        @drop="onDrop(i)"
        @click="store.select(s.id)"
      >
        <v-icon icon="mdi-drag-vertical" size="15" class="pp__grip" />
        <v-icon :icon="specFor(s.type)?.icon ?? 'mdi-shape-outline'" size="15" class="pp__secIc" />
        <span class="pp__secName">
          {{ secLabel(s.type) }}
          <em v-if="s.variant">{{ s.variant }}</em>
        </span>
        <span class="pp__secActs" @click.stop>
          <button type="button" :title="t('builder.toggleVisible')" @click="toggleVisible(s.id, s.visible)">
            <v-icon :icon="s.visible ? 'mdi-eye-outline' : 'mdi-eye-off-outline'" size="14" />
          </button>
          <select
            v-if="pages.length > 1"
            class="pp__move"
            :title="t('builder.moveToPage')"
            @change="moveToPage(s.id, ($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).selectedIndex = 0"
          >
            <option value="">↦</option>
            <option v-for="p in pages.filter((x) => x.id !== activePage?.id)" :key="p.id" :value="p.id">
              {{ p.title }}
            </option>
          </select>
          <button type="button" :title="t('builder.remove')" @click="store.deleteSection(companyId, s.id)">
            <v-icon icon="mdi-close" size="14" />
          </button>
        </span>
      </div>

      <button type="button" class="pp__add" @click="emit('openCatalog', { pageId: activePage!.id })">
        <v-icon icon="mdi-plus" size="16" /> {{ t('builder.addSection') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.pp {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.pp__pages {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  padding: 0.6rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.pp__tab {
  border-radius: 8px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  font-size: 0.78rem;
  font-weight: 600;
}
.pp__tab.is-on {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary) / 0.08);
  color: rgb(var(--v-theme-primary));
}
.pp__tabName {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.35rem 0.6rem;
}
.pp__muted {
  opacity: 0.5;
}
.pp__rename {
  width: 8rem;
  padding: 0.3rem 0.5rem;
  border: 0;
  background: transparent;
  font: inherit;
  color: inherit;
}
.pp__addPage {
  display: grid;
  place-items: center;
  width: 30px;
  border-radius: 8px;
  border: 1px dashed rgb(var(--v-theme-primary) / 0.4);
  color: rgb(var(--v-theme-primary));
}
.pp__pageBar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  padding: 0.5rem 0.6rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.pp__pageBar button {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  border-radius: 7px;
  font-size: 0.72rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.65);
  background: rgb(var(--v-theme-on-surface) / 0.05);
}
.pp__pageBar button:disabled {
  opacity: 0.4;
}
.pp__del {
  margin-left: auto;
  color: rgb(var(--v-theme-error)) !important;
}
.pp__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.pp__sec {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.55rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 9px;
  background: rgb(var(--v-theme-surface));
  cursor: pointer;
  font-size: 0.82rem;
}
.pp__sec.is-sel {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 1px rgb(var(--v-theme-primary) / 0.4);
}
.pp__sec.is-hidden {
  opacity: 0.5;
}
.pp__grip {
  color: rgb(var(--v-theme-on-surface) / 0.35);
  cursor: grab;
}
.pp__secIc {
  color: rgb(var(--v-theme-primary));
  flex: none;
}
.pp__secName {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pp__secName em {
  font-style: normal;
  font-size: 0.68rem;
  color: rgb(var(--v-theme-on-surface) / 0.45);
  margin-left: 0.3rem;
}
.pp__secActs {
  display: flex;
  align-items: center;
  gap: 0.1rem;
}
.pp__secActs button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.pp__secActs button:hover {
  background: rgb(var(--v-theme-on-surface) / 0.08);
}
.pp__move {
  width: 26px;
  height: 24px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-on-surface) / 0.55);
  font-size: 0.75rem;
}
.pp__add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  padding: 0.5rem;
  margin-top: 0.15rem;
  border-radius: 9px;
  font-size: 0.8rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  border: 1px dashed rgb(var(--v-theme-primary) / 0.4);
}
</style>
