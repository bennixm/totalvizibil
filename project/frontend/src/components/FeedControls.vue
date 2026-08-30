<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useFeedStore, type FeedCategoryNode, type FeedSort } from '@/stores/feed'
import type { LocalizedName } from '@/stores/companies'

const { t, locale } = useI18n()
const feed = useFeedStore()

const search = ref(feed.filters.q)
let debounce: ReturnType<typeof setTimeout> | undefined
watch(search, (v) => {
  clearTimeout(debounce)
  debounce = setTimeout(() => feed.setFilter('q', v), 300)
})

const catName = (n: LocalizedName) => n[locale.value as keyof LocalizedName] ?? n.en

const cityItems = computed(() => feed.facets.cities)
const sortItems = computed<{ value: FeedSort; title: string }[]>(() => [
  { value: 'recommended', title: t('feed.sortRecommended') },
  { value: 'newest', title: t('feed.sortNewest') },
  { value: 'rating', title: t('feed.sortRating') },
])

// The parent group currently in focus: either its own slug is selected, or one
// of its niches is.
const openParent = computed<FeedCategoryNode | null>(() => {
  const sel = feed.filters.category
  if (!sel) return null
  return (
    feed.facets.categories.find(
      (p) => p.slug === sel || p.children.some((c) => c.slug === sel),
    ) ?? null
  )
})

function selectParent(p: FeedCategoryNode) {
  feed.setFilter('category', openParent.value?.slug === p.slug ? null : p.slug)
}
function selectChild(slug: string) {
  feed.setFilter('category', feed.filters.category === slug ? (openParent.value?.slug ?? null) : slug)
}
</script>

<template>
  <div class="controls">
    <div class="controls__row">
      <v-text-field
        v-model="search"
        :placeholder="t('feed.searchPlaceholder')"
        prepend-inner-icon="mdi-magnify"
        variant="solo-filled"
        flat
        rounded="pill"
        hide-details
        density="comfortable"
        class="controls__search"
      />
      <v-select
        :model-value="feed.filters.city"
        :items="cityItems"
        :label="t('feed.city')"
        variant="solo-filled"
        flat
        rounded="pill"
        hide-details
        density="comfortable"
        clearable
        style="max-width: 200px"
        @update:model-value="feed.setFilter('city', $event)"
      />
      <v-select
        :model-value="feed.filters.sort"
        :items="sortItems"
        variant="solo-filled"
        flat
        rounded="pill"
        hide-details
        density="comfortable"
        style="max-width: 190px"
        @update:model-value="feed.setFilter('sort', $event)"
      />
    </div>

    <div class="controls__cats">
      <button
        class="cat"
        :class="{ 'cat--on': feed.filters.category === null }"
        @click="feed.setFilter('category', null)"
      >
        {{ t('feed.allCategories') }}
      </button>
      <button
        v-for="c in feed.facets.categories"
        :key="c.slug"
        class="cat"
        :class="{ 'cat--on': openParent?.slug === c.slug }"
        @click="selectParent(c)"
      >
        <v-icon v-if="c.icon" :icon="c.icon" size="15" />
        {{ catName(c.name) }}
      </button>
    </div>

    <!-- Niche subcategories for the focused group -->
    <div v-if="openParent" class="controls__subs">
      <button
        class="sub"
        :class="{ 'sub--on': feed.filters.category === openParent.slug }"
        @click="feed.setFilter('category', openParent.slug)"
      >
        {{ t('feed.allIn', { group: catName(openParent.name) }) }}
      </button>
      <button
        v-for="c in openParent.children"
        :key="c.slug"
        class="sub"
        :class="{ 'sub--on': feed.filters.category === c.slug }"
        @click="selectChild(c.slug)"
      >
        {{ catName(c.name) }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.controls__row {
  display: flex;
  gap: 0.7rem;
  flex-wrap: wrap;
}
.controls__search {
  flex: 1 1 320px;
}
.controls__cats {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding-bottom: 0.3rem;
  scrollbar-width: thin;
}
.cat {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.85rem;
  border-radius: 999px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface) / 0.7);
  font-size: 0.83rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--tvz-dur-fast) var(--tvz-ease-out);
}
.cat:hover {
  color: rgb(var(--v-theme-on-surface));
  border-color: rgba(var(--v-theme-primary), 0.4);
}
.cat--on {
  background: rgb(var(--v-theme-primary));
  border-color: rgb(var(--v-theme-primary));
  color: #fff;
}

.controls__subs {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  padding: 0.65rem 0.85rem;
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-primary) / 0.06);
  border: 1px solid rgb(var(--v-theme-primary) / 0.16);
}
.sub {
  flex: 0 0 auto;
  padding: 0.28rem 0.7rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 500;
  color: rgb(var(--v-theme-on-surface) / 0.7);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--tvz-dur-fast) var(--tvz-ease-out);
}
.sub:hover {
  color: rgb(var(--v-theme-on-surface));
  background: rgb(var(--v-theme-on-surface) / 0.06);
}
.sub--on {
  background: rgb(var(--v-theme-primary));
  color: #fff;
}
</style>
