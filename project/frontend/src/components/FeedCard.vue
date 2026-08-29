<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import PlacementBadge from '@/components/PlacementBadge.vue'
import type { FeedItem } from '@/stores/feed'
import type { LocalizedName } from '@/stores/companies'

const props = defineProps<{ item: FeedItem }>()
const { t, locale } = useI18n()

const categoryName = computed(() => {
  const n = props.item.category?.name
  return n ? (n[locale.value as keyof LocalizedName] ?? n.en) : null
})

const initials = computed(() =>
  props.item.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join(''),
)

const qualityPct = computed(() => Math.round(props.item.scoreBreakdown.quality * 100))
</script>

<template>
  <router-link
    :to="{ name: 'company', params: { slug: item.slug } }"
    class="card"
    :class="{ 'card--sponsored': item.placement === 'sponsored' }"
  >
    <div class="card__top">
      <div class="card__logo">
        <img v-if="item.logoUrl" :src="item.logoUrl" alt="" />
        <span v-else>{{ initials }}</span>
      </div>
      <PlacementBadge :placement="item.placement" />
    </div>

    <h3 class="card__name">{{ item.displayName }}</h3>
    <p class="card__meta">
      <v-icon v-if="item.category?.icon" :icon="item.category.icon" size="14" />
      <span>{{ categoryName }}</span>
      <template v-if="item.location">
        <span class="dot">·</span>
        <v-icon icon="mdi-map-marker-outline" size="14" />
        <span>{{ item.location.city }}</span>
      </template>
    </p>

    <p v-if="item.description" class="card__desc">{{ item.description }}</p>

    <div v-if="item.services.length" class="card__tags">
      <span v-for="s in item.services.slice(0, 3)" :key="s">{{ s }}</span>
    </div>

    <div class="card__foot">
      <span class="card__quality" :title="t('feed.qualityHint')">
        <v-icon icon="mdi-shield-check-outline" size="14" />
        {{ qualityPct }}
      </span>
      <span class="card__cta">
        {{ item.hasWebsite ? t('feed.viewWebsite') : t('feed.viewProfile') }}
        <v-icon icon="mdi-arrow-right" size="15" />
      </span>
    </div>
  </router-link>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 1.15rem 1.2rem 1rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  color: inherit;
  text-decoration: none;
  box-shadow: var(--tvz-shadow-sm);
  transition:
    transform var(--tvz-dur-med) var(--tvz-ease-out),
    box-shadow var(--tvz-dur-med) var(--tvz-ease-out),
    border-color var(--tvz-dur-med) var(--tvz-ease-out);
}
.card:hover {
  transform: translateY(-3px);
  box-shadow: var(--tvz-shadow-lg);
  border-color: rgba(var(--v-theme-primary), 0.35);
}
.card--sponsored {
  border-color: rgba(var(--v-theme-primary), 0.28);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, rgb(var(--v-theme-primary)) 5%, rgb(var(--v-theme-surface))),
    rgb(var(--v-theme-surface))
  );
}

.card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.card__logo {
  width: 40px;
  height: 40px;
  border-radius: 11px;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 0.8rem;
  color: #fff;
  background: var(--tvz-gradient-brand);
  overflow: hidden;
}
.card__logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.card__name {
  font-family: var(--tvz-display, 'Space Grotesk Variable', sans-serif);
  font-weight: 600;
  font-size: 1.05rem;
  letter-spacing: -0.01em;
  margin: 0.1rem 0 0;
}
.card__meta {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-on-surface) / 0.62);
  margin: 0;
}
.card__meta .dot {
  opacity: 0.5;
}
.card__desc {
  font-size: 0.88rem;
  line-height: 1.5;
  color: rgb(var(--v-theme-on-surface) / 0.72);
  margin: 0.15rem 0 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card__tags {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
  margin-top: 0.15rem;
}
.card__tags span {
  font-size: 0.72rem;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: rgb(var(--v-theme-on-surface) / 0.06);
  color: rgb(var(--v-theme-on-surface) / 0.7);
}
.card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.5rem;
  padding-top: 0.7rem;
  border-top: 1px solid var(--tvz-hairline);
  font-size: 0.82rem;
}
.card__quality {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
  font-variant-numeric: tabular-nums;
}
.card__cta {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
}
</style>
