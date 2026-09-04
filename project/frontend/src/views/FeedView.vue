<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import FeedControls from '@/components/FeedControls.vue'
import FeedAdCard from '@/components/FeedAdCard.vue'
import { useFeedStore } from '@/stores/feed'
import { useSeo } from '@/composables/useSeo'
import { feedCategoryRoute } from '@/services/routes'
import type { LocalizedName } from '@/stores/companies'

const props = defineProps<{ group?: string | null; niche?: string | null }>()

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const feed = useFeedStore()
const { items, total, loading, loaded, error, page, pageCount } = storeToRefs(feed)

const resultsTop = ref<HTMLElement | null>(null)
let debounce: ReturnType<typeof setTimeout> | undefined

const catName = (n: LocalizedName): string => n[locale.value as keyof LocalizedName] ?? n.en

/** `BrowseView` resolved these (or neither, for the bare "pick a category" home). */
const routeGroup = computed(() => props.group ?? null)
const routeNiche = computed(() => props.niche ?? null)
const routeCategory = computed(() => routeNiche.value ?? routeGroup.value ?? null)

/** Display names for the current category, resolved from the facet tree. */
const activeNames = computed<{ group: string | null; niche: string | null }>(() => {
  const g = routeGroup.value
  if (!g) return { group: null, niche: null }
  const grp = feed.facets.categories.find((p) => p.slug === g)
  const nch = routeNiche.value ? grp?.children.find((c) => c.slug === routeNiche.value) : null
  return { group: grp ? catName(grp.name) : g, niche: nch ? catName(nch.name) : routeNiche.value }
})

const seoTitle = computed(() => {
  const { group, niche } = activeNames.value
  if (niche) return t('feed.seoTitleNiche', { niche, group })
  if (group) return t('feed.seoTitleGroup', { group })
  return ''
})
const seoDescription = computed(() => {
  const { group, niche } = activeNames.value
  const label = niche || group
  return label ? t('feed.seoDesc', { category: label }) : ''
})
const breadcrumbLd = computed(() => {
  const { group, niche } = activeNames.value
  if (!group) return undefined
  const origin = window.location.origin
  const el = [
    { '@type': 'ListItem', position: 1, name: t('feed.title'), item: `${origin}/` },
    {
      '@type': 'ListItem',
      position: 2,
      name: group,
      item: `${origin}/${routeGroup.value}`,
    },
  ]
  if (niche) {
    el.push({
      '@type': 'ListItem',
      position: 3,
      name: niche,
      item: `${origin}/${routeGroup.value}/${routeNiche.value}`,
    })
  }
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: el }
})

useSeo(() => ({
  title: seoTitle.value || undefined,
  description: seoDescription.value || undefined,
  canonicalPath: routeGroup.value
    ? `/${routeGroup.value}${routeNiche.value ? `/${routeNiche.value}` : ''}`
    : '/',
  jsonLd: breadcrumbLd.value,
  // The bare "pick a category" home is thin — let the category pages be the
  // indexable surface.
  noindex: !routeCategory.value,
}))

/** Push the route-derived category into the store and refetch. */
function syncCategory(): void {
  feed.setCategory(routeCategory.value)
  feed.loadFeed()
}

onMounted(async () => {
  await feed.loadFacets()

  // Legacy `?category=slug` → redirect to the clean path form.
  const legacy = typeof route.query.category === 'string' ? route.query.category : null
  if (legacy && !routeGroup.value) {
    const grp = feed.facets.categories.find(
      (p) => p.slug === legacy || p.children.some((c) => c.slug === legacy),
    )
    if (grp) {
      const isNiche = grp.slug !== legacy
      void router.replace(feedCategoryRoute(grp.slug, isNiche ? legacy : null))
      return
    }
  }

  syncCategory()
})

watch([routeGroup, routeNiche], syncCategory)

// City/area changes keep the current category; just refetch (debounced).
watch(
  () => [feed.filters.area?.lat ?? null, feed.filters.area?.lng ?? null],
  () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => feed.loadFeed(), 250)
  },
)

// Windowed page list, e.g. 1 … 4 5 [6] 7 8 … 20
const pages = computed<(number | '…')[]>(() => {
  const n = pageCount.value
  const c = page.value
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1)
  const out: (number | '…')[] = [1]
  const lo = Math.max(2, c - 1)
  const hi = Math.min(n - 1, c + 1)
  if (lo > 2) out.push('…')
  for (let i = lo; i <= hi; i++) out.push(i)
  if (hi < n - 1) out.push('…')
  out.push(n)
  return out
})

async function go(n: number): Promise<void> {
  await feed.goToPage(n)
  resultsTop.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div class="feed">
    <header class="feed__intro">
      <div>
        <p class="feed__eyebrow">{{ t('feed.eyebrow') }}</p>
        <h1>{{ t('feed.title') }}</h1>
        <p class="feed__lead">{{ t('feed.lead') }}</p>
      </div>
      <v-btn
        :to="{ name: 'create' }"
        color="primary"
        size="large"
        rounded="pill"
        append-icon="mdi-creation"
        class="d-none d-md-inline-flex"
      >
        {{ t('nav.createBusiness') }}
      </v-btn>
    </header>

    <div class="feed__body">
      <FeedControls class="feed__controls" />

      <!-- No category chosen yet: the picker above is the whole page -->
      <div v-if="feed.requiresCategory" class="feed__pick">
        <v-icon icon="mdi-arrow-up" size="26" class="mb-2" />
        <p class="text-body-1 mb-1">{{ t('feed.pickCategoryTitle') }}</p>
        <p class="text-body-2 text-medium-emphasis">{{ t('feed.pickCategoryHint') }}</p>
      </div>

      <template v-else>
        <div ref="resultsTop" class="feed__meta">
          <span v-if="loaded && !loading">{{ t('feed.resultsCount', { n: total }) }}</span>
        </div>

        <!-- Loading skeleton -->
        <div v-if="loading" class="feed__list">
          <div v-for="i in 4" :key="i" class="feed__skeleton" />
        </div>

        <!-- Results -->
        <div v-else-if="items.length" class="feed__list">
          <FeedAdCard v-for="item in items" :key="item.id" :item="item" />
        </div>

        <!-- Empty for this category -->
        <div v-else class="feed__empty">
          <v-icon icon="mdi-store-search-outline" size="34" class="mb-3" />
          <p class="text-body-1 mb-1">{{ error ? t('feed.error') : t('feed.empty') }}</p>
          <p class="text-body-2 text-medium-emphasis">{{ t('feed.emptyHint') }}</p>
        </div>

        <!-- Pagination -->
        <nav v-if="!loading && pageCount > 1" class="feed__pager" :aria-label="t('feed.pagination')">
          <button
            class="pg pg--nav"
            :disabled="page <= 1"
            :aria-label="t('feed.pagePrev')"
            @click="go(page - 1)"
          >
            <v-icon icon="mdi-chevron-left" size="20" />
          </button>
          <template v-for="(p, i) in pages" :key="i">
            <span v-if="p === '…'" class="pg pg--gap">…</span>
            <button v-else class="pg" :class="{ 'pg--on': p === page }" @click="go(p)">{{ p }}</button>
          </template>
          <button
            class="pg pg--nav"
            :disabled="page >= pageCount"
            :aria-label="t('feed.pageNext')"
            @click="go(page + 1)"
          >
            <v-icon icon="mdi-chevron-right" size="20" />
          </button>
        </nav>
      </template>
    </div>
  </div>
</template>

<style scoped>
.feed {
  --feed-w: min(1180px, 92vw);
  padding-bottom: 5rem;
}
.feed__intro {
  width: var(--feed-w);
  margin-inline: auto;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 2rem;
  flex-wrap: wrap;
  padding-top: clamp(2rem, 6vw, 4rem);
  padding-bottom: 2rem;
}
.feed__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 11px;
  font-weight: 600;
  color: var(--tvz-ai);
  margin: 0 0 0.6rem;
}
.feed__intro h1 {
  font-family: 'Space Grotesk Variable', 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: clamp(1.9rem, 4.5vw, 3rem);
  letter-spacing: -0.03em;
  line-height: 1.05;
  margin: 0;
  max-width: 18ch;
  text-wrap: balance;
}
.feed__lead {
  margin: 0.8rem 0 0;
  color: rgb(var(--v-theme-on-surface) / 0.66);
  font-size: 1.02rem;
  max-width: 52ch;
}

.feed__body {
  width: var(--feed-w);
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  gap: 1.15rem;
}
.feed__controls {
  margin-bottom: 0.4rem;
}
.feed__meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
  scroll-margin-top: calc(var(--tvz-topbar-h) + 90px);
}

.feed__list {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.feed__skeleton {
  height: 148px;
  border-radius: var(--tvz-radius-lg);
  border: 1px solid var(--tvz-glass-border);
  background: linear-gradient(
    100deg,
    rgb(var(--v-theme-on-surface) / 0.04) 30%,
    rgb(var(--v-theme-on-surface) / 0.08) 50%,
    rgb(var(--v-theme-on-surface) / 0.04) 70%
  );
  background-size: 200% 100%;
  animation: feed-shine 1.4s ease-in-out infinite;
}
@keyframes feed-shine {
  to {
    background-position: -200% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .feed__skeleton {
    animation: none;
  }
}

.feed__empty,
.feed__pick {
  text-align: center;
  padding: 3.5rem 1rem;
  color: rgb(var(--v-theme-on-surface) / 0.7);
  border: 1px dashed var(--tvz-glass-border);
  border-radius: var(--tvz-radius-lg);
}
.feed__pick .v-icon {
  color: rgb(var(--v-theme-primary));
}

.feed__pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding-top: 1.5rem;
}
.pg {
  min-width: 38px;
  height: 38px;
  padding: 0 0.5rem;
  display: grid;
  place-items: center;
  border-radius: 10px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  font-size: 0.88rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.75);
  cursor: pointer;
  transition:
    background var(--tvz-dur-fast) var(--tvz-ease-out),
    color var(--tvz-dur-fast) var(--tvz-ease-out),
    border-color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.pg:hover:not(:disabled):not(.pg--gap) {
  border-color: rgb(var(--v-theme-primary) / 0.5);
  color: rgb(var(--v-theme-on-surface));
}
.pg--on {
  background: rgb(var(--v-theme-primary));
  border-color: rgb(var(--v-theme-primary));
  color: #fff;
}
.pg--gap {
  border-color: transparent;
  background: transparent;
  cursor: default;
}
.pg--nav:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
