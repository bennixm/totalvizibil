<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import AdsBuilderShell from '@/components/ads/AdsBuilderShell.vue'
import AdsCampaignPicker from '@/components/ads/AdsCampaignPicker.vue'
import { ApiError } from '@/services/api'
import { useSeo } from '@/composables/useSeo'
import { useToastStore } from '@/stores/toast'
import {
  googleAdsUserApi,
  readDraftToken,
  type AdsAccount,
  type SelectionItem,
} from '@/services/googleAdsUser'

/**
 * Step 2: the connected Google user's real accounts and campaigns (live from
 * the Google Ads API, last 30 days). One or several campaigns, across the
 * accounts of this Google login, can be picked. Free.
 */
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const toasts = useToastStore()
useSeo(() => ({ title: t('ads.campaigns.seoTitle'), canonicalPath: '/google-ads/campaigns' }))

const loading = ref(true)
const accounts = ref<AdsAccount[]>([])
const initial = ref<SelectionItem[]>([])
const saving = ref(false)
const loadError = ref('')
/** Google's own reason (from the backend), shown under the message. */
const loadErrorDetail = ref('')
const email = ref<string | null>(null)

const ERRORS = ['denied', 'access_denied', 'expired', 'state', 'scope', 'refresh', 'exchange']

const loadCampaigns = (a: AdsAccount) => googleAdsUserApi.campaigns(a.customerId, a.loginCustomerId)

/** Forget the connected Google account and go back to connecting one. */
const switching = ref(false)
async function switchAccount(): Promise<void> {
  if (switching.value) return
  switching.value = true
  try {
    await googleAdsUserApi.disconnectDraft()
    toasts.success(t('ads.campaigns.switched'))
    void router.replace({ name: 'ads-connect' })
  } catch {
    toasts.error(t('ads.campaigns.switchError'))
  } finally {
    switching.value = false
  }
}

async function confirm(items: SelectionItem[]): Promise<void> {
  if (saving.value) return
  saving.value = true
  try {
    await googleAdsUserApi.select(items)
    void router.push({ name: 'ads-account' })
  } catch (e) {
    toasts.error(
      e instanceof ApiError && e.message === 'unsupported_channel'
        ? t('ads.campaigns.unsupported')
        : t('ads.campaigns.selectError'),
    )
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  const err = typeof route.query.error === 'string' ? route.query.error : ''
  if (err) {
    toasts.error(t(`ads.campaigns.oauthError.${ERRORS.includes(err) ? err : 'exchange'}`))
    void router.replace({ name: 'ads-connect' })
    return
  }
  if (!readDraftToken()) {
    void router.replace({ name: 'ads-connect' })
    return
  }
  try {
    const state = await googleAdsUserApi.state()
    if (state.status !== 'connected') {
      void router.replace({ name: 'ads-connect' })
      return
    }
    email.value = state.googleEmail
    initial.value = state.selections ?? []
    if (route.query.connected) {
      toasts.success(t('ads.campaigns.connected'))
      void router.replace({ query: {} })
    }
    accounts.value = await googleAdsUserApi.accounts()
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
  <AdsBuilderShell current="campaign" wide :title="t('ads.campaigns.title')" :lead="t('ads.campaigns.lead')">
    <div v-if="loading" class="ab-center"><v-progress-circular indeterminate color="primary" /></div>

    <div v-else-if="loadError" class="ab-card ac__narrow">
      <p class="ab-note ab-note--warn"><v-icon icon="mdi-alert-circle-outline" size="18" /> {{ loadError }}</p>
      <p v-if="loadErrorDetail" class="ac__detail">{{ t('ads.campaigns.googleSaid') }} {{ loadErrorDetail }}</p>
      <v-btn color="primary" :loading="switching" @click="switchAccount">{{ t('ads.campaigns.reconnectCta') }}</v-btn>
    </div>

    <div v-else-if="!accounts.length" class="ab-card ac__narrow">
      <p class="ab-note ab-note--warn"><v-icon icon="mdi-account-search-outline" size="18" /> {{ t('ads.campaigns.noAccounts', { email: email ?? '' }) }}</p>
      <v-btn variant="tonal" :loading="switching" @click="switchAccount">{{ t('ads.campaigns.otherAccount') }}</v-btn>
    </div>

    <AdsCampaignPicker
      v-else
      :accounts="accounts"
      :load-campaigns="loadCampaigns"
      :email="email"
      :initial="initial"
      :busy="saving"
      :switching="switching"
      can-switch
      @submit="confirm"
      @switch="switchAccount"
    />

    <div class="ab-back">
      <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" :to="{ name: 'ads-connect' }">
        {{ t('ads.back') }}
      </v-btn>
    </div>
  </AdsBuilderShell>
</template>

<style scoped>
.ac__narrow {
  max-width: 560px;
  margin-inline: auto;
}
.ac__detail {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.6);
  overflow-wrap: anywhere;
}
</style>
