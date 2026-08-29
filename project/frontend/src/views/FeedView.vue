<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import FeedControls from '@/components/FeedControls.vue'
import { useFeedStore } from '@/stores/feed'

const { t } = useI18n()
const feed = useFeedStore()

onMounted(() => feed.loadFacets())
</script>

<template>
  <div class="feed">
    <header class="feed__intro page-container">
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
        append-icon="mdi-sparkles"
        class="d-none d-md-inline-flex"
      >
        {{ t('nav.createBusiness') }}
      </v-btn>
    </header>

    <div class="page-container feed__body">
      <FeedControls class="feed__controls" />

      <div class="feed__placeholder">
        <v-icon icon="mdi-hammer-wrench" size="34" class="mb-3" />
        <p class="text-body-1 mb-1">{{ t('feed.rebuildingTitle') }}</p>
        <p class="text-body-2 text-medium-emphasis">{{ t('feed.rebuildingText') }}</p>
      </div>
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
.feed__body {
  display: flex;
  flex-direction: column;
  gap: 1.6rem;
  padding-bottom: 5rem;
}
.feed__controls {
  position: sticky;
  top: calc(var(--tvz-topbar-h) + 8px);
  z-index: 3;
  padding: 0.9rem;
  margin-inline: -0.9rem;
  border-radius: var(--tvz-radius-lg);
  background: var(--tvz-glass-bg-strong);
  border: 1px solid var(--tvz-glass-border);
}
.feed__placeholder {
  text-align: center;
  padding: 4.5rem 1rem;
  color: rgb(var(--v-theme-on-surface) / 0.7);
  border: 1px dashed var(--tvz-glass-border);
  border-radius: var(--tvz-radius-lg);
}
</style>
