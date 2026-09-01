<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { useFeedStore, type FeedCategoryNode } from '@/stores/feed'
import { feedCategoryRoute } from '@/services/routes'
import type { LocalizedName } from '@/stores/companies'
import { searchCities, type GeoCity } from '@/services/geo'

const { t, locale } = useI18n()
const router = useRouter()
const feed = useFeedStore()

const catName = (n: LocalizedName) => n[locale.value as keyof LocalizedName] ?? n.en
const FALLBACK_ICON = 'mdi-shape-outline'

// --- city filter -------------------------------------------------
const cityItems = ref<GeoCity[]>([])
const searching = ref(false)
let debounce: ReturnType<typeof setTimeout> | undefined

function onCitySearch(q: string): void {
  clearTimeout(debounce)
  debounce = setTimeout(async () => {
    searching.value = true
    try {
      cityItems.value = await searchCities(q)
    } catch {
      cityItems.value = []
    } finally {
      searching.value = false
    }
  }, 200)
}
function onCityPick(name: string | null): void {
  if (!name) {
    feed.setArea(null)
    return
  }
  const c = cityItems.value.find((x) => x.name === name)
  if (c) feed.setArea({ city: c.name, lat: c.lat, lng: c.lng })
}

// --- categories: all groups <-> one focused group ---------------
const selected = computed(() => feed.filters.category)
/** The group drilled into (its own slug, or one of its niches, is picked). */
const focused = computed<FeedCategoryNode | null>(() => {
  const sel = selected.value
  if (!sel) return null
  return (
    feed.facets.categories.find(
      (p) => p.slug === sel || p.children.some((c) => c.slug === sel),
    ) ?? null
  )
})

// Category selection lives in the URL (/feed/{group}/{niche}) so it's a real,
// shareable, SEO-friendly link — FeedView reads it back into the store.
function openGroup(p: FeedCategoryNode): void {
  void router.push(feedCategoryRoute(p.slug))
}
function openGroupRoot(group: FeedCategoryNode): void {
  void router.push(feedCategoryRoute(group.slug))
}
function pickNiche(slug: string): void {
  const group = focused.value
  if (!group) return
  if (selected.value === slug) void router.push(feedCategoryRoute(group.slug))
  else void router.push(feedCategoryRoute(group.slug, slug))
}
function clearCategory(): void {
  void router.push({ name: 'feed' })
}
</script>

<template>
  <div class="fc">
    <!-- City filter -->
    <div class="fc__area">
      <v-autocomplete
        :model-value="feed.filters.area?.city ?? null"
        :items="cityItems"
        item-title="name"
        item-value="name"
        no-filter
        hide-no-data
        hide-details
        clearable
        :loading="searching"
        :label="t('feed.areaCity')"
        :placeholder="t('feed.areaCityPlaceholder')"
        prepend-inner-icon="mdi-map-marker-radius-outline"
        variant="solo-filled"
        flat
        rounded="lg"
        density="comfortable"
        class="fc__city"
        @update:search="onCitySearch"
        @update:model-value="onCityPick"
      >
        <template #item="{ props: ip, item }">
          <v-list-item v-bind="ip" :title="item.raw.name" :subtitle="item.raw.county" />
        </template>
      </v-autocomplete>
      <p v-if="feed.filters.area" class="fc__areaNote">
        <v-icon icon="mdi-map-marker-check-outline" size="14" />
        {{ t('feed.areaNote', { city: feed.filters.area.city }) }}
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
            :class="{ 'niche--on': selected === focused.slug }"
            @click="openGroupRoot(focused)"
          >
            {{ t('feed.allIn', { group: catName(focused.name) }) }}
          </button>
          <button
            v-for="ch in focused.children"
            :key="ch.slug"
            type="button"
            class="niche"
            :class="{ 'niche--on': selected === ch.slug }"
            @click="pickNiche(ch.slug)"
          >
            {{ catName(ch.name) }}
          </button>
        </div>
      </div>

      <template v-else>
        <p class="fc__catsHead">{{ t('feed.browseCategories') }}</p>
        <div class="fc__grid">
          <button
            v-for="(c, i) in feed.facets.categories"
            :key="c.slug"
            type="button"
            class="gcard"
            :style="{ '--d': `${(i % 6) * 0.35}s` }"
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
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface) / 0.5);
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
  border-radius: 20px;
  border: 1px solid color-mix(in srgb, rgb(var(--v-theme-primary)) 22%, transparent);
  background: linear-gradient(
    160deg,
    rgb(var(--v-theme-primary) / 0.18) 0%,
    rgb(var(--v-theme-primary) / 0.05) 44%,
    rgb(var(--v-theme-surface)) 100%
  );
  overflow: hidden;
  cursor: pointer;
  transition:
    transform 0.2s var(--tvz-ease-out),
    border-color 0.2s var(--tvz-ease-out),
    box-shadow 0.2s var(--tvz-ease-out);
}
/* soft glow bleeding from the top */
.gcard::after {
  content: '';
  position: absolute;
  inset: -45% 15% auto;
  height: 75%;
  background: radial-gradient(closest-side, rgb(var(--v-theme-primary) / 0.28), transparent);
  opacity: 0.55;
  pointer-events: none;
  transition: opacity 0.2s var(--tvz-ease-out);
}
.gcard:hover {
  transform: translateY(-5px);
  border-color: rgb(var(--v-theme-primary) / 0.6);
  box-shadow: 0 22px 48px rgb(var(--v-theme-primary) / 0.24);
}
.gcard:hover::after {
  opacity: 0.9;
}
.gcard__ic {
  position: relative;
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 18px;
  color: #fff;
  background: var(--tvz-gradient-brand, linear-gradient(150deg, rgb(var(--v-theme-primary)), rgb(var(--v-theme-secondary, var(--v-theme-primary)))));
  box-shadow: 0 10px 24px rgb(var(--v-theme-primary) / 0.42);
  animation: gcard-bob 3.6s ease-in-out infinite;
  animation-delay: var(--d, 0s);
  transition:
    transform 0.24s var(--tvz-ease-out),
    box-shadow 0.24s var(--tvz-ease-out);
}
.gcard:hover .gcard__ic {
  transform: scale(1.16) rotate(-7deg);
  box-shadow: 0 16px 34px rgb(var(--v-theme-primary) / 0.5);
  animation-play-state: paused;
}
@keyframes gcard-bob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-6px);
  }
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
  border-radius: 22px;
  border: 1px solid rgb(var(--v-theme-primary) / 0.32);
  background: linear-gradient(
    150deg,
    rgb(var(--v-theme-primary) / 0.16) 0%,
    rgb(var(--v-theme-primary) / 0.04) 46%,
    rgb(var(--v-theme-surface)) 100%
  );
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
  color: rgb(var(--v-theme-on-surface) / 0.75);
  cursor: pointer;
}
.focus__back:hover {
  color: rgb(var(--v-theme-primary));
  border-color: rgb(var(--v-theme-primary) / 0.5);
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
  width: 72px;
  height: 72px;
  flex: none;
  border-radius: 20px;
  color: #fff;
  background: var(--tvz-gradient-brand, linear-gradient(150deg, rgb(var(--v-theme-primary)), rgb(var(--v-theme-secondary, var(--v-theme-primary)))));
  box-shadow: 0 12px 28px rgb(var(--v-theme-primary) / 0.42);
  animation: gcard-bob 3.6s ease-in-out infinite;
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
  color: rgb(var(--v-theme-on-surface) / 0.6);
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
  color: rgb(var(--v-theme-on-surface) / 0.72);
  background: rgb(var(--v-theme-on-surface) / 0.06);
  border: 1px solid transparent;
  cursor: pointer;
  transition:
    background 0.14s var(--tvz-ease-out),
    color 0.14s var(--tvz-ease-out),
    border-color 0.14s var(--tvz-ease-out);
}
.niche:hover {
  color: rgb(var(--v-theme-on-surface));
  border-color: rgb(var(--v-theme-primary) / 0.4);
}
.niche--on {
  background: rgb(var(--v-theme-primary));
  color: #fff;
}

@media (prefers-reduced-motion: reduce) {
  .gcard__ic,
  .focus__ic {
    animation: none;
  }
  .gcard:hover {
    transform: none;
  }
}
</style>
