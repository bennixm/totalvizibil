<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { useCompaniesStore, type DashboardPayload, type LocalizedName } from '@/stores/companies'

const { t, locale } = useI18n()
const route = useRoute()
const auth = useAuthStore()
const companies = useCompaniesStore()

const loading = ref(true)
const publishing = ref(false)
const dashboard = ref<DashboardPayload | null>(null)

const metricCards = [
  { key: 'traffic', icon: 'mdi-chart-areaspline' },
  { key: 'clicks', icon: 'mdi-cursor-default-click-outline' },
  { key: 'calls', icon: 'mdi-phone-outline' },
  { key: 'leads', icon: 'mdi-email-outline' },
  { key: 'credit', icon: 'mdi-wallet-outline' },
] as const

function localized(name: LocalizedName | null | undefined): string {
  if (!name) return '—'
  return name[locale.value as keyof LocalizedName] ?? name.en
}

const companyId = computed(() => dashboard.value?.company.id ?? null)
const website = computed(() => dashboard.value?.website ?? null)
const isLive = computed(() => website.value?.status !== 'none' && (website.value as { isLive?: boolean })?.isLive)

const statusText = computed(() => {
  const s = dashboard.value?.company.status
  return s ? t(`dashboard.status${s.charAt(0).toUpperCase()}${s.slice(1)}`) : '—'
})
const statusColor = computed(() =>
  dashboard.value?.company.status === 'active'
    ? 'success'
    : dashboard.value?.company.status === 'suspended'
      ? 'error'
      : 'warning',
)

async function reload() {
  await companies.ensureLoaded()
  if (!companies.hasCompany) return
  const wanted =
    (typeof route.query.company === 'string' &&
      companies.list.find((c) => c.id === route.query.company)) ||
    companies.primary
  if (wanted) dashboard.value = await companies.fetchDashboard(wanted.id)
}

async function togglePublish() {
  if (!companyId.value) return
  publishing.value = true
  try {
    dashboard.value = await companies.setPublished(companyId.value, !isLive.value)
  } finally {
    publishing.value = false
  }
}

onMounted(async () => {
  try {
    await reload()
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <v-container class="py-10">
    <div class="page-container d-flex flex-column ga-6">
      <div v-if="loading" class="d-flex justify-center py-16">
        <v-progress-circular indeterminate color="primary" />
      </div>

      <template v-else-if="!companies.hasCompany">
        <div class="tvz-card pa-8 text-center d-flex flex-column align-center ga-3">
          <v-avatar color="primary" variant="tonal" size="56" rounded="lg">
            <v-icon icon="mdi-sparkles" size="30" />
          </v-avatar>
          <h1 class="text-h5 font-weight-bold font-display">{{ t('dashboard.noCompanyTitle') }}</h1>
          <p class="text-body-1 text-medium-emphasis" style="max-width: 46ch">
            {{ t('dashboard.noCompanyText') }}
          </p>
          <v-btn :to="{ name: 'create' }" color="primary" variant="flat" rounded="pill">
            {{ t('nav.createBusiness') }}
          </v-btn>
        </div>
      </template>

      <template v-else-if="dashboard">
        <div class="d-flex align-center flex-wrap ga-3">
          <h1 class="text-h4 font-weight-bold font-display">
            {{ t('dashboard.welcome', { name: auth.user?.name ?? '' }) }}
          </h1>
          <v-chip :color="statusColor" size="small" variant="tonal">{{ statusText }}</v-chip>
        </div>

        <!-- Website -->
        <v-card border flat class="tvz-card">
          <v-card-item>
            <template #prepend><v-icon icon="mdi-web" color="primary" /></template>
            <v-card-title class="font-display">{{ dashboard.company.displayName }}</v-card-title>
            <v-card-subtitle>
              {{ website?.status === 'none' ? t('dashboard.noWebsite') : t('dashboard.websiteReady') }}
            </v-card-subtitle>
          </v-card-item>
          <v-card-text>
            <div class="d-flex align-center flex-wrap ga-3">
              <v-chip
                size="small"
                variant="tonal"
                :color="isLive ? 'success' : 'default'"
                :prepend-icon="isLive ? 'mdi-broadcast' : 'mdi-eye-off-outline'"
              >
                {{ isLive ? t('dashboard.live') : t('dashboard.notLive') }}
              </v-chip>
              <span v-if="website && website.status !== 'none'" class="text-caption text-medium-emphasis">
                {{ t('dashboard.builtWith', { mode: t(`create.${website.mode}Title`) }) }}
              </span>
              <v-spacer />
              <v-btn
                v-if="isLive"
                :to="{ name: 'company', params: { slug: dashboard.company.slug } }"
                variant="text"
                size="small"
                prepend-icon="mdi-open-in-new"
              >
                {{ t('dashboard.viewPublic') }}
              </v-btn>
              <v-btn
                v-if="website && website.status !== 'none'"
                :color="isLive ? undefined : 'primary'"
                :variant="isLive ? 'outlined' : 'flat'"
                rounded="pill"
                size="small"
                :loading="publishing"
                :prepend-icon="isLive ? 'mdi-pause' : 'mdi-broadcast'"
                @click="togglePublish"
              >
                {{ isLive ? t('dashboard.unpublish') : t('dashboard.publish') }}
              </v-btn>
              <v-btn
                v-else
                :to="{ name: 'create' }"
                color="primary"
                variant="flat"
                rounded="pill"
                size="small"
                prepend-icon="mdi-sparkles"
              >
                {{ t('dashboard.buildWebsite') }}
              </v-btn>
            </div>
          </v-card-text>
        </v-card>

        <!-- Profile -->
        <v-card border flat class="tvz-card">
          <v-card-item>
            <v-card-title class="font-display">{{ t('dashboard.profile') }}</v-card-title>
          </v-card-item>
          <v-card-text>
            <v-row>
              <v-col cols="6" sm="3">
                <div class="text-caption text-medium-emphasis">{{ t('dashboard.categoryLabel') }}</div>
                <div class="font-weight-medium">{{ localized(dashboard.company.category?.name) }}</div>
              </v-col>
              <v-col cols="6" sm="3">
                <div class="text-caption text-medium-emphasis">{{ t('dashboard.locationLabel') }}</div>
                <div class="font-weight-medium">
                  {{ dashboard.company.primaryLocation?.city ?? '—' }}
                </div>
              </v-col>
              <v-col cols="6" sm="3">
                <div class="text-caption text-medium-emphasis">{{ t('dashboard.contactsLabel') }}</div>
                <div class="font-weight-medium">{{ dashboard.company.contactsCount }}</div>
              </v-col>
              <v-col cols="6" sm="3">
                <div class="text-caption text-medium-emphasis">{{ t('dashboard.servicesLabel') }}</div>
                <div class="font-weight-medium">{{ dashboard.company.servicesCount }}</div>
              </v-col>
            </v-row>
            <div class="mt-5">
              <div class="text-caption text-medium-emphasis mb-1">
                {{ t('dashboard.profileCompleteness', { score: dashboard.profileCompleteness.score }) }}
              </div>
              <v-progress-linear
                :model-value="dashboard.profileCompleteness.score"
                color="primary"
                height="8"
                rounded
              />
            </div>
          </v-card-text>
        </v-card>

        <!-- Metrics (not implemented yet — shown honestly) -->
        <div>
          <v-row>
            <v-col v-for="card in metricCards" :key="card.key" cols="6" sm="4" md="3" lg="2">
              <v-card border flat class="pa-2 tvz-card">
                <v-card-item>
                  <v-icon :icon="card.icon" color="primary" class="mb-2" />
                  <div class="text-caption text-medium-emphasis">
                    {{ t(`dashboard.cards.${card.key}`) }}
                  </div>
                  <div class="text-h6 font-weight-bold">—</div>
                </v-card-item>
              </v-card>
            </v-col>
          </v-row>
          <p class="text-caption text-medium-emphasis mt-2">{{ t('dashboard.metricsNote') }}</p>
        </div>
      </template>
    </div>
  </v-container>
</template>
