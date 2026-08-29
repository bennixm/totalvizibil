<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import WebsiteRenderer from '@/components/WebsiteRenderer.vue'
import { apiFetch, ApiError } from '@/services/api'
import type { WebsiteContent, WebsiteTheme } from '@/stores/draft'
import type { LocalizedName } from '@/stores/companies'

interface PublicCompany {
  id: string
  slug: string
  displayName: string
  description: string | null
  logoUrl: string | null
  category: { slug: string; name: LocalizedName } | null
  locations: { city: string; region: string | null; address: string | null; isPrimary: boolean }[]
  contacts: { type: string; value: string }[]
  services: { name: string; description: string | null }[]
  website: { mode: string; theme: WebsiteTheme; content: WebsiteContent } | null
}

const { t, locale } = useI18n()
const route = useRoute()

const company = ref<PublicCompany | null>(null)
const loading = ref(true)
const notFound = ref(false)

async function load(slug: string) {
  loading.value = true
  notFound.value = false
  try {
    company.value = await apiFetch<PublicCompany>(`/public/companies/${slug}`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound.value = true
    company.value = null
  } finally {
    loading.value = false
  }
}

onMounted(() => load(String(route.params.slug)))
watch(
  () => route.params.slug,
  (s) => s && load(String(s)),
)

const phone = computed(() => company.value?.contacts.find((c) => c.type === 'phone')?.value)
const email = computed(() => company.value?.contacts.find((c) => c.type === 'email')?.value)
const primaryLocation = computed(
  () => company.value?.locations.find((l) => l.isPrimary) ?? company.value?.locations[0] ?? null,
)
const categoryName = computed(() => {
  const n = company.value?.category?.name
  return n ? (n[locale.value as keyof LocalizedName] ?? n.en) : null
})
</script>

<template>
  <div class="cp">
    <div class="cp__bar page-container">
      <v-btn :to="{ name: 'feed' }" variant="text" prepend-icon="mdi-arrow-left" size="small">
        {{ t('company.backToFeed') }}
      </v-btn>
      <div class="cp__bar-actions">
        <v-btn v-if="phone" :href="`tel:${phone}`" variant="tonal" size="small" prepend-icon="mdi-phone">
          {{ t('company.call') }}
        </v-btn>
        <v-btn
          v-if="email"
          :href="`mailto:${email}`"
          color="primary"
          variant="flat"
          size="small"
          prepend-icon="mdi-email-outline"
        >
          {{ t('company.contact') }}
        </v-btn>
      </div>
    </div>

    <div v-if="loading" class="cp__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <div v-else-if="notFound" class="cp__center cp__missing">
      <v-icon icon="mdi-store-off-outline" size="40" class="mb-3" />
      <p class="text-body-1">{{ t('company.notFound') }}</p>
      <v-btn :to="{ name: 'feed' }" variant="tonal" rounded="pill" class="mt-3">
        {{ t('company.backToFeed') }}
      </v-btn>
    </div>

    <template v-else-if="company">
      <!-- Website identity -->
      <div v-if="company.website" class="page-container cp__site">
        <WebsiteRenderer :content="company.website.content" :theme="company.website.theme" />
      </div>

      <!-- Fallback identity page (no generated website) -->
      <div v-else class="page-container cp__profile">
        <div class="cp__hero">
          <div class="cp__logo">
            <img v-if="company.logoUrl" :src="company.logoUrl" alt="" />
            <span v-else>{{ company.displayName.charAt(0) }}</span>
          </div>
          <p v-if="categoryName" class="cp__cat">{{ categoryName }}</p>
          <h1>{{ company.displayName }}</h1>
          <p v-if="company.description" class="cp__desc">{{ company.description }}</p>
          <p v-if="primaryLocation" class="cp__loc">
            <v-icon icon="mdi-map-marker-outline" size="16" />
            {{ primaryLocation.city }}<span v-if="primaryLocation.region">, {{ primaryLocation.region }}</span>
          </p>
        </div>

        <div v-if="company.services.length" class="cp__services">
          <h2>{{ t('company.services') }}</h2>
          <div class="cp__services-grid">
            <div v-for="s in company.services" :key="s.name" class="cp__service">
              <h3>{{ s.name }}</h3>
              <p v-if="s.description">{{ s.description }}</p>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cp__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-block: 1rem;
}
.cp__bar-actions {
  display: flex;
  gap: 0.5rem;
}
.cp__center {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 5rem 1rem;
}
.cp__missing {
  color: rgb(var(--v-theme-on-surface) / 0.7);
}
.cp__site {
  padding-bottom: 4rem;
}
.cp__profile {
  padding-bottom: 5rem;
}
.cp__hero {
  text-align: center;
  padding: 3rem 1rem;
}
.cp__logo {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  margin: 0 auto 1.2rem;
  display: grid;
  place-items: center;
  font-size: 1.6rem;
  font-weight: 700;
  color: #fff;
  background: var(--tvz-gradient-brand);
  overflow: hidden;
}
.cp__logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cp__cat {
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 11px;
  color: rgb(var(--v-theme-primary));
  margin: 0 0 0.5rem;
  font-weight: 600;
}
.cp__hero h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.8rem, 5vw, 2.8rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.cp__desc {
  max-width: 54ch;
  margin: 1rem auto 0.6rem;
  color: rgb(var(--v-theme-on-surface) / 0.72);
}
.cp__loc {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
  font-size: 0.9rem;
}
.cp__services {
  max-width: 900px;
  margin: 0 auto;
}
.cp__services h2 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.4rem;
  margin-bottom: 1.2rem;
}
.cp__services-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
}
.cp__service {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  padding: 1.2rem;
  background: rgb(var(--v-theme-surface));
}
.cp__service h3 {
  font-size: 1rem;
  margin: 0 0 0.4rem;
}
.cp__service p {
  font-size: 0.88rem;
  color: rgb(var(--v-theme-on-surface) / 0.66);
  margin: 0;
}
</style>
