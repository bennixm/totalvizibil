<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdsCampaignPicker from '@/components/ads/AdsCampaignPicker.vue'
import '@/components/ads/ads.css'
import { ApiError } from '@/services/api'
import { useToastStore } from '@/stores/toast'
import { useGoogleAdsUserStore } from '@/stores/googleAdsUser'
import {
  googleAdsUserApi,
  type AdsAccount,
  type GoogleConnection,
  type SelectionItem,
} from '@/services/googleAdsUser'

/**
 * Add campaigns to the panel from a Google account that is ALREADY
 * connected: same picker as the builder, no new Google sign-in. Campaigns
 * already in the panel are shown but cannot be picked again.
 */
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const toasts = useToastStore()
const adsStore = useGoogleAdsUserStore()

const id = computed(() => String(route.params.id))
const conn = ref<GoogleConnection | null>(null)
const accounts = ref<AdsAccount[]>([])
const loading = ref(true)
const loadError = ref('')
const loadErrorDetail = ref('')
const saving = ref(false)

const loadCampaigns = (a: AdsAccount) =>
  googleAdsUserApi.connectionCampaigns(id.value, a.customerId, a.loginCustomerId)

async function add(items: SelectionItem[]): Promise<void> {
  if (saving.value) return
  saving.value = true
  try {
    const { campaignIds, taken } = await googleAdsUserApi.addCampaigns(id.value, items)
    await adsStore.fetch(true)
    toasts.success(campaignIds.length > 1 ? t('ads.account.doneN', { n: campaignIds.length }) : t('ads.account.done'))
    if (taken?.length) toasts.warning(t('ads.campaigns.taken', { names: taken.join(', ') }))
    if (campaignIds[0]) void router.push({ name: 'ads-dashboard', params: { id: campaignIds[0] } })
    else void router.push({ name: 'ads-connections' })
  } catch (e) {
    toasts.error(
      e instanceof ApiError && e.message === 'unsupported_channel'
        ? t('ads.campaigns.unsupported')
        : e instanceof ApiError && e.message === 'campaign_managed_elsewhere'
          ? t('ads.campaigns.managedElsewhere')
          : e instanceof ApiError
          ? e.message
          : t('ads.campaigns.selectError'),
    )
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  try {
    const all = await googleAdsUserApi.connections()
    conn.value = all.find((c) => c.id === id.value) ?? null
    if (!conn.value) {
      void router.replace({ name: 'ads-connections' })
      return
    }
    accounts.value = await googleAdsUserApi.connectionAccounts(id.value)
  } catch (e) {
    loadErrorDetail.value =
      e instanceof ApiError && e.message !== 'google_ads_reconnect_required' ? e.message : ''
    loadError.value =
      e instanceof ApiError && e.message === 'google_ads_reconnect_required'
        ? t('ads.campaigns.reconnect')
        : t('ads.campaigns.loadError')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <v-container class="ad" fluid>
    <AdminPageHeader eyebrow="Google Ads" :title="t('ads.conn.addTitle')" :hint="t('ads.conn.addLead')">
      <template #actions>
        <v-btn variant="text" prepend-icon="mdi-arrow-left" :to="{ name: 'ads-connections' }">
          {{ t('ads.conn.title') }}
        </v-btn>
      </template>
    </AdminPageHeader>

    <div v-if="loading" class="ab-center"><v-progress-circular indeterminate color="primary" /></div>
    <div v-else-if="loadError" class="ab-card ad__narrow">
      <p class="ab-note ab-note--warn"><v-icon icon="mdi-alert-circle-outline" size="18" /> {{ loadError }}</p>
      <p v-if="loadErrorDetail" class="ad__detail">{{ t('ads.campaigns.googleSaid') }} {{ loadErrorDetail }}</p>
      <v-btn variant="tonal" :to="{ name: 'ads-connections' }">{{ t('ads.conn.title') }}</v-btn>
    </div>
    <div v-else-if="!accounts.length" class="ab-card ad__narrow">
      <p class="ab-note ab-note--warn">
        <v-icon icon="mdi-account-search-outline" size="18" />
        {{ t('ads.campaigns.noAccounts', { email: conn?.googleEmail ?? '' }) }}
      </p>
    </div>
    <AdsCampaignPicker
      v-else
      :accounts="accounts"
      :load-campaigns="loadCampaigns"
      :email="conn?.googleEmail ?? null"
      :busy="saving"
      @submit="add"
    />
  </v-container>
</template>

<style scoped>
.ad {
  max-width: 1100px;
}
.ad__narrow {
  max-width: 560px;
}
.ad__detail {
  margin: 0;
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
  overflow-wrap: anywhere;
}
</style>
