<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import WebsiteRenderer from '@/components/WebsiteRenderer.vue'
import { apiFetch, ApiError } from '@/services/api'
import { trackCall } from '@/services/leads'
import { useSeo } from '@/composables/useSeo'
import { companyCrumbs, companyRoute } from '@/services/routes'
import type { WebsiteContent, WebsiteTheme } from '@/types/website'
import type { LocalizedName } from '@/stores/companies'

interface PublicCompany {
  id: string
  slug: string
  displayName: string
  description: string | null
  logoUrl: string | null
  category: {
    slug: string
    name: LocalizedName
    parent: { slug: string; name: LocalizedName } | null
  } | null
  locations: {
    city: string | null
    region: string | null
    address: string | null
    country?: string
    isPrimary: boolean
    nationwide?: boolean
  }[]
  contacts: { type: string; value: string }[]
  services: { name: string; description: string | null }[]
  website: { mode: string; theme: WebsiteTheme; content: WebsiteContent } | null
}

const props = defineProps<{ crumbs: string[] }>()

const { t, locale } = useI18n()
const router = useRouter()

const company = ref<PublicCompany | null>(null)
const loading = ref(true)
const notFound = ref(false)
const leadSent = ref(false)

/** The company slug is always the LAST crumb (`BrowseView` resolved the rest). */
const slug = computed(() => props.crumbs[props.crumbs.length - 1] ?? '')

function onBarCall(): void {
  if (company.value) trackCall(company.value.slug)
}

async function load(s: string) {
  loading.value = true
  notFound.value = false
  try {
    company.value = await apiFetch<PublicCompany>(`/public/companies/${s}`)
    // Redirect a bare or mis-prefixed URL to the canonical category path.
    const canonical = companyCrumbs(company.value)
    if (props.crumbs.join('/') !== canonical.join('/')) {
      void router.replace(companyRoute(company.value))
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound.value = true
    company.value = null
  } finally {
    loading.value = false
  }
}

onMounted(() => load(slug.value))
watch(slug, (s) => s && load(s))

const phone = computed(() => company.value?.contacts.find((c) => c.type === 'phone')?.value)
const email = computed(() => company.value?.contacts.find((c) => c.type === 'email')?.value)
const primaryLocation = computed(
  () => company.value?.locations.find((l) => l.isPrimary) ?? company.value?.locations[0] ?? null,
)
const catLoc = (n?: LocalizedName | null): string | null =>
  n ? (n[locale.value as keyof LocalizedName] ?? n.en) : null
const categoryName = computed(() => catLoc(company.value?.category?.name))
const parentName = computed(() => catLoc(company.value?.category?.parent?.name))

// --- SEO: title, description, canonical + LocalBusiness / breadcrumb JSON-LD ---
useSeo(() => {
  const c = company.value
  if (!c) {
    return notFound.value
      ? { title: t('company.notFound'), noindex: true }
      : { noindex: true }
  }
  const origin = window.location.origin
  const path = `/${companyCrumbs(c).join('/')}`
  const city = primaryLocation.value?.city
  const descParts = [
    c.description?.trim(),
    categoryName.value && city ? t('company.seoDesc', { category: categoryName.value, city }) : null,
  ].filter(Boolean)

  const crumbs = companyCrumbs(c)
  const breadcrumb: Record<string, unknown>[] = [
    { '@type': 'ListItem', position: 1, name: t('feed.title'), item: `${origin}/` },
  ]
  if (parentName.value && crumbs.length >= 3) {
    breadcrumb.push({
      '@type': 'ListItem',
      position: 2,
      name: parentName.value,
      item: `${origin}/${crumbs[0]}`,
    })
  }
  if (categoryName.value) {
    breadcrumb.push({
      '@type': 'ListItem',
      position: breadcrumb.length + 1,
      name: categoryName.value,
      item: `${origin}/${crumbs.slice(0, -1).join('/')}`,
    })
  }
  breadcrumb.push({ '@type': 'ListItem', position: breadcrumb.length + 1, name: c.displayName })

  const business: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: c.displayName,
    url: `${origin}${path}`,
    ...(c.description ? { description: c.description } : {}),
    ...(c.logoUrl ? { image: c.logoUrl } : {}),
    ...(phone.value ? { telephone: phone.value } : {}),
    ...(email.value ? { email: email.value } : {}),
    ...(primaryLocation.value?.city
      ? {
          address: {
            '@type': 'PostalAddress',
            addressLocality: primaryLocation.value.city,
            ...(primaryLocation.value.region
              ? { addressRegion: primaryLocation.value.region }
              : {}),
            addressCountry: primaryLocation.value.country ?? 'RO',
          },
        }
      : {}),
    ...(c.services.length
      ? {
          makesOffer: c.services.map((s) => ({
            '@type': 'Offer',
            itemOffered: { '@type': 'Service', name: s.name },
          })),
        }
      : {}),
  }

  return {
    title: city ? `${c.displayName} · ${city}` : c.displayName,
    description: descParts.join(' — ') || undefined,
    canonicalPath: path,
    jsonLd: [
      business,
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: breadcrumb },
    ],
  }
})
</script>

<template>
  <div class="cp">
    <div class="cp__bar">
      <v-btn :to="{ name: 'feed' }" variant="text" prepend-icon="mdi-arrow-left" size="small">
        {{ t('company.backToFeed') }}
      </v-btn>
      <p v-if="company" class="cp__barName">{{ company.displayName }}</p>
      <div class="cp__bar-actions">
        <v-btn
          v-if="phone"
          :href="`tel:${phone}`"
          variant="tonal"
          size="small"
          prepend-icon="mdi-phone"
          @click="onBarCall"
        >
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
      <!-- Full website preview (edge to edge, like visiting the real site) -->
      <div v-if="company.website" class="cp__site">
        <WebsiteRenderer
          class="cp__renderer"
          :content="company.website.content"
          :theme="company.website.theme"
          :lead-slug="company.slug"
          @lead-sent="leadSent = true"
        />
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
          <p v-if="primaryLocation && (primaryLocation.city || primaryLocation.nationwide)" class="cp__loc">
            <v-icon icon="mdi-map-marker-outline" size="16" />
            <template v-if="primaryLocation.nationwide">{{ t('feed.coverageCountry') }}</template>
            <template v-else
              >{{ primaryLocation.city
              }}<span v-if="primaryLocation.region">, {{ primaryLocation.region }}</span></template
            >
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

    <v-snackbar v-model="leadSent" :timeout="4000" color="success" location="bottom">
      {{ t('company.leadSent') }}
    </v-snackbar>
  </div>
</template>

<style scoped>
.cp__bar {
  position: sticky;
  top: var(--tvz-topbar-h);
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.6rem clamp(0.9rem, 3vw, 1.5rem);
  background: var(--tvz-glass-bg-strong);
  border-bottom: 1px solid var(--tvz-hairline);
}
.cp__barName {
  flex: 1;
  text-align: center;
  margin: 0;
  font-weight: 600;
  font-size: 0.9rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
/* The generated site renders full width, no frame — a real full preview. */
.cp__site :deep(.site) {
  border: 0;
  border-radius: 0;
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
