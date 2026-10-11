<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import {
  useFeedStore,
  NATIONWIDE,
  completeServicesSlug,
  isCompleteServicesSlug,
  type FeedCategoryNode,
  type FeedCategoryLeaf,
} from '@/stores/feed'
import { feedCategoryRoute } from '@/services/routes'
import type { LocalizedName } from '@/stores/companies'

const { t, locale } = useI18n()
const router = useRouter()
const feed = useFeedStore()

const catName = (n: LocalizedName) => n[locale.value as keyof LocalizedName] ?? n.en
const FALLBACK_ICON = 'mdi-shape-outline'

// --- category search: finds the group/subcategory the user meant from free
// text, so they don't have to know which top-level group it lives under.
// Matches diacritic-insensitively (Romanian keyboards often skip ă/â/î/ș/ț).
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}
interface SearchHit {
  group: FeedCategoryNode
  leaf: FeedCategoryLeaf | null
  label: string
}
const searchQuery = ref('')
const searchFocused = ref(false)
const searchHits = computed<SearchHit[]>(() => {
  const q = normalize(searchQuery.value.trim())
  if (!q) return []
  const hits: SearchHit[] = []
  for (const g of feed.facets.categories) {
    const gName = catName(g.name)
    if (normalize(gName).includes(q)) hits.push({ group: g, leaf: null, label: gName })
    for (const c of g.children) {
      const cName = catName(c.name)
      if (normalize(cName).includes(q)) hits.push({ group: g, leaf: c, label: cName })
    }
  }
  return hits.slice(0, 8)
})
const searchOpen = computed(() => searchFocused.value)
function selectHit(hit: SearchHit): void {
  void router.push(
    hit.leaf ? feedCategoryRoute(hit.group.slug, hit.leaf.slug) : feedCategoryRoute(hit.group.slug),
  )
  searchQuery.value = ''
  searchFocused.value = false
}
function closeSearch(): void {
  searchQuery.value = ''
  searchFocused.value = false
}
function onSearchKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeSearch()
  else if (e.key === 'Enter' && searchHits.value[0]) selectHit(searchHits.value[0])
}

// --- județ filter: multi-select + two exclusive special modes -----
/** Explicit "no location filter at all" — distinct from `null`/unset only in
 *  the picker's own display; functionally identical ("every județ" below). */
const ANY_LOCATION = '__any__'
const countyItems = computed(() => [
  { title: t('feed.areaAny'), value: ANY_LOCATION },
  { title: t('feed.areaNationwide'), value: NATIONWIDE },
  ...feed.facets.counties.map((c) => ({ title: c, value: c })),
])
const countySelections = computed<string[]>(() => {
  const c = feed.filters.county
  if (!c) return [ANY_LOCATION]
  if (c === NATIONWIDE) return [NATIONWIDE]
  return c
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
})
/** Picking either sentinel is exclusive — it replaces any specific județe;
 *  picking a specific județ drops both sentinels. */
function onCountySelectionsChange(vals: string[]): void {
  const prev = countySelections.value
  if (vals.includes(ANY_LOCATION) && !prev.includes(ANY_LOCATION)) {
    feed.setCounty(null)
    return
  }
  if (vals.includes(NATIONWIDE) && !prev.includes(NATIONWIDE)) {
    feed.setCounty(NATIONWIDE)
    return
  }
  const real = vals.filter((v) => v !== ANY_LOCATION && v !== NATIONWIDE)
  feed.setCounty(real.length ? real.join(',') : null)
}

// --- categories: all groups <-> one focused group ------------------
/** The group drilled into. `selected` may be a bare group, one or several
 *  comma-joined niches, or the "Servicii complete" sentinel — the group is
 *  always resolvable from just the first token. */
const selected = computed(() => feed.filters.category)
const firstToken = computed(() => selected.value?.split(',')[0]?.trim() ?? null)
const focused = computed<FeedCategoryNode | null>(() => {
  const first = firstToken.value
  if (!first) return null
  return (
    feed.facets.categories.find(
      (p) =>
        p.slug === first ||
        p.children.some((c) => c.slug === first) ||
        (isCompleteServicesSlug(first) && first.endsWith(p.slug)),
    ) ?? null
  )
})
type CategoryMode = 'all' | 'complete' | 'specific'
const categoryMode = computed<CategoryMode>(() => {
  const group = focused.value
  if (!group || !selected.value) return 'all'
  if (selected.value === group.slug) return 'all'
  if (isCompleteServicesSlug(selected.value)) return 'complete'
  return 'specific'
})
const selectedNiches = computed<string[]>(() => {
  if (categoryMode.value !== 'specific' || !selected.value) return []
  return selected.value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
})

// Category selection lives in the URL (/feed/{group}/{niche}) so it's a real,
// shareable, SEO-friendly link — FeedView reads it back into the store.
function openGroup(p: FeedCategoryNode): void {
  void router.push(feedCategoryRoute(p.slug))
}
function clearCategory(): void {
  void router.push({ name: 'feed' })
}
/** "Toate din X" (union, the bare group) or "Servicii complete X" (every
 *  subcategory at once) — mutually exclusive with specific niche picks. */
function setCategoryMode(group: FeedCategoryNode, mode: 'all' | 'complete'): void {
  if (mode === 'all') void router.push(feedCategoryRoute(group.slug))
  else void router.push(feedCategoryRoute(group.slug, completeServicesSlug(group.slug)))
}
/** Toggle one niche in the multi-select; dropping the last one falls back
 *  to "Toate din X" rather than leaving the search with nothing picked. */
function toggleNiche(group: FeedCategoryNode, slug: string): void {
  const current = categoryMode.value === 'specific' ? selectedNiches.value : []
  const next = current.includes(slug)
    ? current.filter((s) => s !== slug)
    : [...current, slug]
  if (!next.length) void router.push(feedCategoryRoute(group.slug))
  else void router.push(feedCategoryRoute(group.slug, next.join(',')))
}
</script>

<template>
  <div class="fc">
    <div class="fc__top">
      <!-- Category search: free text finds the matching category/subcategory
           directly, without having to browse the group grid below. -->
      <div class="fc__search" :class="{ 'is-open': searchOpen }">
        <div class="fc__searchBox">
          <v-icon icon="mdi-magnify" size="19" class="fc__searchIcon" />
          <input
            v-model="searchQuery"
            type="text"
            class="fc__searchInput"
            :placeholder="t('feed.searchPlaceholder')"
            @focus="searchFocused = true"
            @blur="searchFocused = false"
            @keydown="onSearchKeydown"
          />
          <button
            v-if="searchOpen"
            type="button"
            class="fc__searchClose"
            :aria-label="t('common.close')"
            @mousedown.prevent="closeSearch"
          >
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>
        <div v-if="searchOpen" class="fc__searchPanel">
          <p v-if="!searchQuery.trim()" class="fc__searchHint">{{ t('feed.searchHint') }}</p>
          <p v-else-if="!searchHits.length" class="fc__searchEmpty">{{ t('feed.searchEmpty') }}</p>
          <button
            v-for="(hit, i) in searchHits"
            :key="i"
            type="button"
            class="fc__searchHit"
            @mousedown.prevent="selectHit(hit)"
          >
            <v-icon :icon="hit.leaf ? 'mdi-tag-outline' : (hit.group.icon || FALLBACK_ICON)" size="18" />
            <span class="fc__searchHitText">
              <span class="fc__searchHitLabel">{{ hit.label }}</span>
              <span v-if="hit.leaf" class="fc__searchHitGroup">{{ catName(hit.group.name) }}</span>
            </span>
          </button>
        </div>
      </div>

      <!-- Județ filter -->
      <div class="fc__area">
        <v-select
          :model-value="countySelections"
          :items="countyItems"
          hide-details
          multiple
          chips
          closable-chips
          :label="t('feed.areaCounty')"
          :placeholder="t('feed.areaCountyPlaceholder')"
          prepend-inner-icon="mdi-map-marker-outline"
          variant="solo-filled"
          flat
          rounded="lg"
          density="comfortable"
          class="fc__city"
          @update:model-value="onCountySelectionsChange"
        />
        <p v-if="feed.filters.county" class="fc__areaNote">
          <v-icon icon="mdi-map-marker-check-outline" size="14" />
          {{
            feed.filters.county === NATIONWIDE
              ? t('feed.areaNoteNationwide')
              : t('feed.areaNote', { county: countySelections.join(', ') })
          }}
        </p>
      </div>
    </div>

    <!-- Categories: all groups, or one drilled-in group -->
    <div class="fc__cats">
      <div v-if="focused" class="focus">
        <button type="button" class="focus__back" @click="clearCategory">
          <v-icon icon="mdi-arrow-left" size="16" /> {{ t('feed.backToCategories') }}
        </button>
        <div class="focus__head">
          <span class="focus__ic">
            <v-icon :icon="focused.icon || FALLBACK_ICON" size="38" />
          </span>
          <div>
            <h3>{{ catName(focused.name) }}</h3>
            <p>{{ t('feed.pickNiche') }}</p>
          </div>
        </div>
        <div class="focus__subs">
          <button
            type="button"
            class="niche"
            :class="{ 'niche--on': categoryMode === 'all' }"
            @click="setCategoryMode(focused, 'all')"
          >
            {{ t('feed.allIn', { group: catName(focused.name) }) }}
          </button>
          <button
            type="button"
            class="niche niche--complete"
            :class="{ 'niche--on': categoryMode === 'complete' }"
            @click="setCategoryMode(focused, 'complete')"
          >
            {{ t('feed.completeServices', { group: catName(focused.name) }) }}
          </button>
          <button
            v-for="ch in focused.children"
            :key="ch.slug"
            type="button"
            class="niche"
            :class="{ 'niche--on': selectedNiches.includes(ch.slug) }"
            :disabled="categoryMode === 'complete'"
            @click="toggleNiche(focused, ch.slug)"
          >
            {{ catName(ch.name) }}
          </button>
        </div>
      </div>

      <template v-else>
        <p class="fc__catsHead">{{ t('feed.browseCategories') }}</p>
        <div class="fc__grid">
          <button
            v-for="c in feed.facets.categories"
            :key="c.slug"
            type="button"
            class="gcard"
            @click="openGroup(c)"
          >
            <span class="gcard__ic">
              <v-icon :icon="c.icon || FALLBACK_ICON" size="34" />
            </span>
            <span class="gcard__name">{{ catName(c.name) }}</span>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.fc {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* --- search + county, side by side --- */
.fc__top {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  flex-wrap: wrap;
}
.fc__search {
  position: relative;
  flex: 1 1 320px;
  min-width: 260px;
  max-width: 420px;
}
.fc__searchBox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 48px;
  padding: 0 0.9rem;
  border-radius: var(--tvz-radius-lg);
  background: rgba(var(--v-theme-on-surface), 0.045);
  border: 1px solid transparent;
  transition:
    border-color 0.16s var(--tvz-ease-out),
    background 0.16s var(--tvz-ease-out);
}
.fc__search.is-open .fc__searchBox {
  background: rgb(var(--v-theme-surface));
  border-color: rgba(var(--v-theme-primary), 0.45);
  box-shadow: var(--tvz-shadow-sm);
}
.fc__searchIcon {
  flex: none;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.fc__searchInput {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-size: 0.9rem;
  color: rgb(var(--v-theme-on-surface));
}
.fc__searchInput::placeholder {
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.fc__searchClose {
  flex: none;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.fc__searchClose:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.fc__searchPanel {
  position: absolute;
  top: calc(100% + 0.5rem);
  left: 0;
  right: 0;
  z-index: 20;
  max-height: 360px;
  overflow-y: auto;
  padding: 0.4rem;
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--tvz-glass-border);
  box-shadow: var(--tvz-shadow-md);
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.fc__searchHint,
.fc__searchEmpty {
  margin: 0;
  padding: 0.6rem 0.7rem;
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.fc__searchHit {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.7rem;
  border-radius: 10px;
  text-align: left;
  color: rgb(var(--v-theme-on-surface));
}
.fc__searchHit:hover {
  background: rgba(var(--v-theme-primary), 0.1);
}
.fc__searchHit > .v-icon {
  flex: none;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.fc__searchHitText {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.fc__searchHitLabel {
  font-size: 0.87rem;
  font-weight: 600;
}
.fc__searchHitGroup {
  font-size: 0.74rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* Mobile: the results panel takes over the full screen instead of a cramped
   dropdown — easier to scan and tap with one hand. */
@media (max-width: 680px) {
  .fc__search {
    flex: 1 1 100%;
    max-width: none;
  }
  .fc__search.is-open {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    flex-direction: column;
    padding: 0.75rem;
    background: rgb(var(--v-theme-surface));
  }
  .fc__search.is-open .fc__searchBox {
    flex: none;
    box-shadow: none;
  }
  .fc__search.is-open .fc__searchPanel {
    position: static;
    flex: 1 1 auto;
    margin-top: 0.6rem;
    max-height: none;
    box-shadow: none;
    border: none;
  }
}

/* --- city --- */
.fc__area {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex: 1 1 320px;
}
.fc__city {
  max-width: 420px;
}
.fc__areaNote {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-primary));
}

/* --- category grid --- */
.fc__catsHead {
  margin: 0 0 0.9rem;
  font-size: 0.8125rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--tvz-label, rgba(var(--v-theme-on-surface), 0.55));
}
.fc__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
  gap: 1rem;
}
.gcard {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.85rem;
  padding: 1.7rem 1rem 1.4rem;
  text-align: center;
  border-radius: var(--tvz-radius-lg);
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  box-shadow: var(--tvz-shadow-sm);
  overflow: hidden;
  cursor: pointer;
  transition:
    transform 0.16s var(--tvz-ease-out),
    border-color 0.16s var(--tvz-ease-out),
    box-shadow 0.16s var(--tvz-ease-out);
}
.gcard:hover {
  transform: translateY(-3px);
  border-color: rgba(var(--v-theme-primary), 0.45);
  box-shadow: var(--tvz-shadow-md);
}
.gcard__ic {
  position: relative;
  display: grid;
  place-items: center;
  width: 60px;
  height: 60px;
  border-radius: var(--tvz-radius-md);
  color: #fff;
  background: rgb(var(--v-theme-primary));
  transition: transform 0.16s var(--tvz-ease-out);
}
.gcard:hover .gcard__ic {
  transform: scale(1.06);
}
.gcard__name {
  position: relative;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 600;
  font-size: 1rem;
  letter-spacing: -0.01em;
}

/* --- focused group --- */
.focus {
  padding: 1.35rem 1.4rem 1.5rem;
  border-radius: var(--tvz-radius-lg);
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  box-shadow: var(--tvz-shadow-sm);
}
.focus__back {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.7rem 0.3rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.75);
  cursor: pointer;
}
.focus__back:hover {
  color: rgb(var(--v-theme-primary));
  border-color: rgba(var(--v-theme-primary), 0.5);
}
.focus__head {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin: 1rem 0 1.15rem;
}
.focus__ic {
  display: grid;
  place-items: center;
  width: 68px;
  height: 68px;
  flex: none;
  border-radius: var(--tvz-radius-md);
  color: #fff;
  background: rgb(var(--v-theme-primary));
}
.focus__head h3 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.3rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0;
}
.focus__head p {
  margin: 0.15rem 0 0;
  font-size: 0.83rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.focus__subs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.niche {
  padding: 0.42rem 0.9rem;
  border-radius: 999px;
  font-size: 0.83rem;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.72);
  background: rgba(var(--v-theme-on-surface), 0.06);
  border: 1px solid transparent;
  cursor: pointer;
  transition:
    background 0.14s var(--tvz-ease-out),
    color 0.14s var(--tvz-ease-out),
    border-color 0.14s var(--tvz-ease-out);
}
.niche:hover {
  color: rgb(var(--v-theme-on-surface));
  border-color: rgba(var(--v-theme-primary), 0.4);
}
.niche--on {
  background: rgb(var(--v-theme-primary));
  color: #fff;
}
.niche--complete {
  border-color: rgba(var(--v-theme-primary), 0.35);
}
.niche--complete:not(.niche--on) {
  background: transparent;
}
.niche:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

@media (prefers-reduced-motion: reduce) {
  .gcard,
  .gcard:hover,
  .gcard:hover .gcard__ic {
    transform: none;
  }
}
</style>
