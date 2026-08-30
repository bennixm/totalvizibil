<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { pingAdClick } from '@/services/ads'
import type { FeedItem } from '@/stores/feed'
import type { LocalizedName } from '@/stores/companies'

const props = defineProps<{ item: FeedItem }>()

const { t, locale } = useI18n()

function onOpen(): void {
  pingAdClick(props.item.id)
}

function loc(n?: LocalizedName): string | null {
  return n ? (n[locale.value as keyof LocalizedName] ?? n.en) : null
}

const catName = computed(() => loc(props.item.category?.name))
const parentName = computed(() => loc(props.item.category?.parent?.name ?? undefined))

const shownServices = computed(() => props.item.services.slice(0, 4))
const extraServices = computed(() => Math.max(0, props.item.services.length - 4))
const initial = computed(() => props.item.displayName.charAt(0).toUpperCase())
</script>

<template>
  <RouterLink
    class="lst"
    :to="{ name: 'company', params: { slug: item.slug } }"
    @click="onOpen"
  >
    <span class="lst__spine" aria-hidden="true" />

    <div class="lst__media">
      <img v-if="item.logoUrl" :src="item.logoUrl" alt="" />
      <span v-else>{{ initial }}</span>
    </div>

    <div class="lst__main">
      <p v-if="catName" class="lst__crumb">
        <span v-if="parentName">{{ parentName }}</span>
        <v-icon v-if="parentName" icon="mdi-chevron-right" size="13" />
        <span class="lst__niche">{{ catName }}</span>
      </p>

      <h3 class="lst__name">{{ item.displayName }}</h3>

      <p v-if="item.location" class="lst__loc">
        <v-icon icon="mdi-map-marker-outline" size="14" />
        {{ item.location.city }}<span v-if="item.location.region">, {{ item.location.region }}</span>
      </p>

      <p v-if="item.description" class="lst__desc">{{ item.description }}</p>

      <div v-if="shownServices.length" class="lst__tags">
        <span v-for="s in shownServices" :key="s" class="lst__tag">{{ s }}</span>
        <span v-if="extraServices" class="lst__tag lst__tag--more">+{{ extraServices }}</span>
      </div>
    </div>

    <div class="lst__aside">
      <span class="lst__cta">
        {{ t('feed.viewSite') }}
        <v-icon icon="mdi-arrow-right" size="18" class="lst__arrow" />
      </span>
    </div>
  </RouterLink>
</template>

<style scoped>
.lst {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 1.5rem;
  width: 100%;
  padding: 1.4rem 1.6rem 1.4rem 1.9rem;
  border-radius: var(--tvz-radius-lg);
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  color: inherit;
  text-decoration: none;
  overflow: hidden;
  box-shadow: var(--tvz-shadow-sm);
  transition:
    transform var(--tvz-dur-med) var(--tvz-ease-out),
    border-color var(--tvz-dur-med) var(--tvz-ease-out),
    box-shadow var(--tvz-dur-med) var(--tvz-ease-out);
}
.lst:hover {
  transform: translateX(3px);
  border-color: rgb(var(--v-theme-primary) / 0.45);
  box-shadow: var(--tvz-shadow-lg);
}

/* Left accent spine — the modern signature of the listing. */
.lst__spine {
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: rgb(var(--v-theme-on-surface) / 0.12);
  transition: width var(--tvz-dur-med) var(--tvz-ease-out);
}
.lst:hover .lst__spine {
  width: 6px;
  background: rgb(var(--v-theme-primary));
}

.lst__media {
  display: grid;
  place-items: center;
  width: 84px;
  height: 84px;
  border-radius: 20px;
  font-size: 1.9rem;
  font-weight: 700;
  color: #fff;
  background: var(--tvz-gradient-brand);
  box-shadow: 0 0 0 4px rgb(var(--v-theme-primary) / 0.08);
  overflow: hidden;
  flex: none;
}
.lst__media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.lst__main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.lst__crumb {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  margin: 0;
  font-family: var(--tvz-mono, ui-monospace, monospace);
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.13em;
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
.lst__niche {
  color: rgb(var(--v-theme-primary));
}
.lst__name {
  font-family: 'Space Grotesk Variable', 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 1.3rem;
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0;
}
.lst__loc {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0;
  font-size: 0.82rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.lst__desc {
  margin: 0.15rem 0 0;
  font-size: 0.9rem;
  line-height: 1.55;
  color: rgb(var(--v-theme-on-surface) / 0.72);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.lst__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.35rem;
}
.lst__tag {
  font-size: 0.72rem;
  padding: 0.18rem 0.55rem;
  border-radius: 8px;
  background: rgb(var(--v-theme-on-surface) / 0.06);
  color: rgb(var(--v-theme-on-surface) / 0.7);
  white-space: nowrap;
}
.lst__tag--more {
  color: rgb(var(--v-theme-on-surface) / 0.5);
}

.lst__aside {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.7rem;
  flex: none;
}
.lst__cta {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
}
.lst__arrow {
  transition: transform var(--tvz-dur-med) var(--tvz-ease-out);
}
.lst:hover .lst__arrow {
  transform: translateX(4px);
}

@media (max-width: 720px) {
  .lst {
    grid-template-columns: auto minmax(0, 1fr);
    gap: 1rem;
    padding: 1.1rem 1.1rem 1.1rem 1.4rem;
  }
  .lst__media {
    width: 56px;
    height: 56px;
    border-radius: 14px;
    font-size: 1.3rem;
  }
  .lst__name {
    font-size: 1.1rem;
  }
  .lst__aside {
    grid-column: 1 / -1;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}

@media (prefers-reduced-motion: reduce) {
  .lst,
  .lst__arrow,
  .lst__spine {
    transition: none;
  }
  .lst:hover {
    transform: none;
  }
}
</style>
