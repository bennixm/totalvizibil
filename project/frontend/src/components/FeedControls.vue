<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import {
  useFeedStore,
  NATIONWIDE,
  completeServicesSlug,
  isCompleteServicesSlug,
  type FeedCategoryNode,
} from '@/stores/feed'
import { feedCategoryRoute } from '@/services/routes'
import type { LocalizedName } from '@/stores/companies'

const { t, locale } = useI18n()
const router = useRouter()
const feed = useFeedStore()

const catName = (n: LocalizedName) => n[locale.value as keyof LocalizedName] ?? n.en
const FALLBACK_ICON = 'mdi-shape-outline'

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

/* --- city --- */
.fc__area {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
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
