<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { pingAdClick } from '@/services/ads'
import { companyRoute } from '@/services/routes'
import type { FeedItem } from '@/stores/feed'
import type { LocalizedName } from '@/stores/companies'

const props = defineProps<{ item: FeedItem }>()

const { t, locale } = useI18n()

const to = computed(() =>
  companyRoute({
    slug: props.item.slug,
    category: props.item.category
      ? { slug: props.item.category.slug, parent: props.item.category.parent }
      : null,
  }),
)

function onOpen(): void {
  pingAdClick(props.item.id)
}

function loc(n?: LocalizedName): string | null {
  return n ? (n[locale.value as keyof LocalizedName] ?? n.en) : null
}

const catName = computed(() => loc(props.item.category?.name))
const parentName = computed(() => loc(props.item.category?.parent?.name ?? undefined))

const shownServices = computed(() => props.item.services.slice(0, 6))
const extraServices = computed(() =>
  Math.max(0, props.item.servicesTotal - shownServices.value.length),
)
const initial = computed(() => props.item.displayName.charAt(0).toUpperCase())

// Advanced-builder sites get the media-forward "own website" card.
const featured = computed(() => props.item.builtWithBuilder)
const accentColor = computed(() => props.item.accent || 'rgb(var(--v-theme-primary))')

const headline = computed(() => {
  const h = props.item.heroTitle?.trim()
  return h && h.toLowerCase() !== props.item.displayName.trim().toLowerCase()
    ? h
    : props.item.displayName
})
const blurb = computed(
  () => props.item.heroSubtitle?.trim() || props.item.description || null,
)
// standard-card tagline: only when it adds something over the name
const tagline = computed(() => {
  const h = props.item.heroTitle?.trim()
  return h && h.toLowerCase() !== props.item.displayName.trim().toLowerCase() ? h : null
})
</script>

<template>
  <!-- ===== Featured: site built with the Advanced builder ===== -->
  <RouterLink
    v-if="featured"
    class="fc"
    :to="to"
    :style="{ '--card-accent': accentColor }"
    @click="onOpen"
  >
    <div class="fc__banner" :class="{ 'fc__banner--plain': !item.heroImage }">
      <img v-if="item.heroImage" :src="item.heroImage" alt="" loading="lazy" />
      <span v-else class="fc__grad" aria-hidden="true" />
      <span class="fc__scrim" aria-hidden="true" />
      <div class="fc__top">
        <span class="fc__badge">
          <v-icon icon="mdi-web" size="13" /> {{ t('feed.ownSite') }}
        </span>
        <span class="btnv btnv--onphoto">
          {{ t('feed.viewSite') }} <v-icon icon="mdi-arrow-right" size="16" />
        </span>
      </div>
      <p class="fc__headline">{{ headline }}</p>
    </div>

    <div class="fc__body">
      <p v-if="catName" class="fc__crumb">
        <span v-if="parentName">{{ parentName }}</span>
        <v-icon v-if="parentName" icon="mdi-chevron-right" size="12" />
        <span class="fc__niche">{{ catName }}</span>
      </p>

      <h3 class="fc__name">{{ item.displayName }}</h3>
      <p v-if="blurb" class="fc__blurb">{{ blurb }}</p>

      <p v-if="item.location" class="fc__loc">
        <v-icon icon="mdi-map-marker-outline" size="14" />
        <template v-if="item.location.nationwide">{{ t('feed.coverageCountry') }}</template>
        <template v-else>
          {{ item.location.city
          }}<span v-if="item.location.radiusKm"> · {{ t('feed.coverageKm', { n: item.location.radiusKm }) }}</span>
        </template>
      </p>

      <div v-if="shownServices.length" class="tags">
        <span v-for="s in shownServices" :key="s" class="tag">{{ s }}</span>
        <span v-if="extraServices" class="tag tag--more">+{{ extraServices }}</span>
      </div>
    </div>
  </RouterLink>

  <!-- ===== Standard listing row ===== -->
  <RouterLink v-else class="lst" :to="to" @click="onOpen">
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
      <p v-if="tagline" class="lst__tagline">{{ tagline }}</p>

      <p v-if="item.location" class="lst__loc">
        <v-icon icon="mdi-map-marker-outline" size="14" />
        <template v-if="item.location.nationwide">{{ t('feed.coverageCountry') }}</template>
        <template v-else>
          {{ item.location.city
          }}<span v-if="item.location.radiusKm"> · {{ t('feed.coverageKm', { n: item.location.radiusKm }) }}</span>
        </template>
      </p>

      <p v-if="item.description" class="lst__desc">{{ item.description }}</p>

      <div v-if="shownServices.length" class="tags">
        <span v-for="s in shownServices" :key="s" class="tag">{{ s }}</span>
        <span v-if="extraServices" class="tag tag--more">+{{ extraServices }}</span>
      </div>
    </div>

    <div class="lst__aside">
      <span class="btnv btnv--ghost">
        {{ t('feed.viewSite') }} <v-icon icon="mdi-arrow-right" size="17" class="btnv__arrow" />
      </span>
    </div>
  </RouterLink>
</template>

<style scoped>
/* ---------- shared bits ---------- */
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.5rem;
}
.tag {
  font-size: 0.74rem;
  padding: 0.22rem 0.6rem;
  border-radius: 8px;
  background: rgb(var(--v-theme-on-surface) / 0.06);
  color: rgb(var(--v-theme-on-surface) / 0.72);
  white-space: nowrap;
}
.tag--more {
  color: rgb(var(--v-theme-on-surface) / 0.5);
}

.btnv {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.6rem 1.1rem;
  border-radius: 999px;
  font-size: 0.86rem;
  font-weight: 700;
  white-space: nowrap;
  transition:
    transform var(--tvz-dur-med) var(--tvz-ease-out),
    box-shadow var(--tvz-dur-med) var(--tvz-ease-out),
    background var(--tvz-dur-med) var(--tvz-ease-out);
}
.btnv--ghost {
  color: rgb(var(--v-theme-primary));
  border: 1.5px solid rgb(var(--v-theme-primary) / 0.35);
}
/* pill sitting on top of the featured banner photo */
.btnv--onphoto {
  padding: 0.45rem 0.9rem;
  font-size: 0.8rem;
  color: #0b0d14;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(6px);
  box-shadow: 0 6px 20px -8px rgba(0, 0, 0, 0.5);
}
.btnv__arrow {
  transition: transform var(--tvz-dur-med) var(--tvz-ease-out);
}

/* ---------- standard row ---------- */
.lst {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 1.5rem;
  width: 100%;
  padding: 1.5rem 1.7rem 1.5rem 2rem;
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
.lst::after {
  content: '';
  position: absolute;
  inset: -40% -30% auto auto;
  width: 260px;
  height: 200px;
  background: radial-gradient(closest-side, rgb(var(--v-theme-primary) / 0.14), transparent);
  opacity: 0;
  transition: opacity var(--tvz-dur-med) var(--tvz-ease-out);
  pointer-events: none;
}
.lst:hover {
  transform: translateY(-3px);
  border-color: rgb(var(--v-theme-primary) / 0.45);
  box-shadow: var(--tvz-shadow-lg);
}
.lst:hover::after {
  opacity: 1;
}
.lst:hover .btnv--ghost {
  background: rgb(var(--v-theme-primary) / 0.08);
}
.lst:hover .btnv__arrow {
  transform: translateX(4px);
}
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
  width: 92px;
  height: 92px;
  border-radius: 18px;
  font-size: 2rem;
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
  gap: 0.32rem;
}
.lst__crumb,
.fc__crumb {
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
.lst__niche,
.fc__niche {
  color: rgb(var(--v-theme-primary));
}
.lst__name {
  font-family: 'Space Grotesk Variable', 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 1.5rem;
  letter-spacing: -0.02em;
  line-height: 1.14;
  margin: 0;
}
.lst__tagline {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 500;
  color: rgb(var(--v-theme-on-surface) / 0.78);
}
.lst__loc,
.fc__loc {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0.1rem 0 0;
  font-size: 0.82rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.lst__desc {
  margin: 0.25rem 0 0;
  font-size: 0.92rem;
  line-height: 1.55;
  color: rgb(var(--v-theme-on-surface) / 0.72);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.lst__aside {
  display: flex;
  align-items: center;
  flex: none;
}

/* ---------- featured card ---------- */
.fc {
  position: relative;
  display: block;
  width: 100%;
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
.fc:hover {
  transform: translateY(-4px);
  border-color: color-mix(in srgb, var(--card-accent) 55%, transparent);
  box-shadow: 0 26px 54px -30px color-mix(in srgb, var(--card-accent) 60%, transparent);
}
.fc:hover .btnv--onphoto {
  background: #fff;
  transform: translateY(-1px);
}
.fc__banner {
  position: relative;
  aspect-ratio: 16 / 6;
  overflow: hidden;
}
.fc__banner--plain {
  aspect-ratio: auto;
  height: 128px;
}
.fc__banner img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.fc__top {
  position: absolute;
  top: 0.9rem;
  left: 0.9rem;
  right: 0.9rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}
.fc__grad {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    135deg,
    var(--card-accent),
    color-mix(in srgb, var(--card-accent) 45%, #0b0b12)
  );
}
.fc__scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(10, 12, 22, 0.15) 0%, rgba(10, 12, 22, 0.78) 100%);
}
.fc__badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.28rem 0.65rem;
  border-radius: 999px;
  font-size: 0.66rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #fff;
  background: color-mix(in srgb, var(--card-accent) 78%, rgba(0, 0, 0, 0.45));
  backdrop-filter: blur(4px);
}
.fc__headline {
  position: absolute;
  left: 1.3rem;
  right: 1.3rem;
  bottom: 1rem;
  margin: 0;
  font-family: 'Space Grotesk Variable', 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: clamp(1.2rem, 2.4vw, 1.55rem);
  letter-spacing: -0.02em;
  line-height: 1.2;
  color: #fff;
  text-shadow: 0 2px 20px rgba(0, 0, 0, 0.5);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.fc__body {
  padding: 1.2rem 1.6rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.fc__name {
  font-family: 'Space Grotesk Variable', 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 1.3rem;
  letter-spacing: -0.02em;
  margin: 0.1rem 0 0;
}
.fc__blurb {
  margin: 0.2rem 0 0;
  font-size: 0.94rem;
  line-height: 1.55;
  color: rgb(var(--v-theme-on-surface) / 0.74);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

@media (max-width: 720px) {
  .lst {
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 1rem;
    padding: 1.2rem 1.2rem 1.3rem 1.5rem;
  }
  .lst__media {
    width: 56px;
    height: 56px;
    border-radius: 14px;
    font-size: 1.35rem;
    align-self: flex-start;
  }
  .lst__name {
    font-size: 1.2rem;
  }
  .lst__aside {
    grid-column: 1 / -1;
  }
  .btnv--ghost {
    width: 100%;
    justify-content: center;
  }
  .fc__body {
    padding: 1.1rem 1.2rem 1.4rem;
  }
  .btnv--solid {
    width: 100%;
    justify-content: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .lst,
  .fc,
  .btnv,
  .btnv__arrow,
  .lst__spine {
    transition: none;
  }
  .lst:hover,
  .fc:hover {
    transform: none;
  }
}
</style>
