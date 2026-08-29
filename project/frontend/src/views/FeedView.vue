<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import FeedControls from '@/components/FeedControls.vue'
import FeedCard from '@/components/FeedCard.vue'
import { useFeedStore } from '@/stores/feed'

const { t } = useI18n()
const feed = useFeedStore()

onMounted(async () => {
  if (!feed.facets.categories.length) await feed.loadFacets()
  if (!feed.loaded) await feed.load()
})
</script>

<template>
  <div class="feed">
    <header class="feed__intro page-container">
      <div class="feed__intro-text">
        <p class="feed__eyebrow">{{ t('feed.eyebrow') }}</p>
        <h1>{{ t('feed.title') }}</h1>
        <p class="feed__lead">{{ t('feed.lead') }}</p>
      </div>
      <v-btn
        :to="{ name: 'create' }"
        color="primary"
        size="large"
        rounded="pill"
        append-icon="mdi-sparkles"
        class="feed__cta"
      >
        {{ t('nav.createBusiness') }}
      </v-btn>
    </header>

    <div class="page-container feed__body">
      <FeedControls class="feed__controls" />

      <div v-if="feed.loading && !feed.items.length" class="feed__grid">
        <v-skeleton-loader v-for="i in 6" :key="i" type="card" class="feed__skeleton" />
      </div>

      <div v-else-if="feed.items.length" class="feed__grid">
        <FeedCard v-for="item in feed.items" :key="item.id" :item="item" />
      </div>

      <div v-else class="feed__empty">
        <v-icon icon="mdi-store-search-outline" size="40" class="mb-3" />
        <p class="text-body-1 mb-1">{{ t('feed.emptyTitle') }}</p>
        <p class="text-body-2 text-medium-emphasis mb-4">{{ t('feed.emptyText') }}</p>
        <v-btn variant="tonal" rounded="pill" @click="feed.reset()">{{ t('feed.clearFilters') }}</v-btn>
      </div>

      <p v-if="feed.rankingNote" class="feed__ranking">
        <v-icon icon="mdi-scale-balance" size="14" />
        {{ feed.rankingNote }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.feed__intro {
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
.feed__cta {
  margin-bottom: 0.3rem;
}

.feed__body {
  display: flex;
  flex-direction: column;
  gap: 1.6rem;
  padding-bottom: 5rem;
}
.feed__controls {
  position: sticky;
  top: 76px;
  z-index: 3;
  padding: 0.9rem;
  margin-inline: -0.9rem;
  border-radius: var(--tvz-radius-lg);
  background: var(--tvz-glass-bg-strong);
  backdrop-filter: blur(var(--tvz-glass-blur));
  -webkit-backdrop-filter: blur(var(--tvz-glass-blur));
  border: 1px solid var(--tvz-glass-border);
}
.feed__grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}
.feed__skeleton {
  border-radius: var(--tvz-radius-lg);
}
.feed__empty {
  text-align: center;
  padding: 4rem 1rem;
  color: rgb(var(--v-theme-on-surface) / 0.7);
}
.feed__ranking {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.78rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
  max-width: 70ch;
  margin: 0.5rem 0 0;
}
</style>
