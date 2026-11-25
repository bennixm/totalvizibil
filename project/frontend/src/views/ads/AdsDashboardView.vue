<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import GaChip from '@/components/admin/google-ads/GaChip.vue'
import AdsOverviewTab from '@/components/ads/AdsOverviewTab.vue'
import AdsAgentTab from '@/components/ads/AdsAgentTab.vue'
import AdsChatTab from '@/components/ads/AdsChatTab.vue'
import AdsProposalsTab from '@/components/ads/AdsProposalsTab.vue'
import AdsSettingsTab from '@/components/ads/AdsSettingsTab.vue'
import AdsCostsTab from '@/components/ads/AdsCostsTab.vue'
import { dateTime, strengthTone } from '@/components/ads/format'
import '@/components/ads/ads.css'
import { ApiError } from '@/services/api'
import { useToastStore } from '@/stores/toast'
import { useGoogleAdsUserStore } from '@/stores/googleAdsUser'
import { googleAdsUserApi, type UserCampaignDetail } from '@/services/googleAdsUser'

/**
 * Dedicated dashboard of ONE customer Google Ads campaign: overview, the
 * optimization agent, proposals to approve (budget changes always), agent
 * settings and costs. Replaces the business panel while a Google Ads
 * campaign is selected in the panel's campaign switcher.
 */
const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const toasts = useToastStore()
const adsStore = useGoogleAdsUserStore()

const TABS = ['overview', 'agent', 'chat', 'proposals', 'settings', 'costs'] as const
type Tab = (typeof TABS)[number]

const detail = ref<UserCampaignDetail | null>(null)
const loadError = ref('')
const syncing = ref(false)
const welcome = ref(route.query.welcome === '1')
let poll: ReturnType<typeof setTimeout> | undefined

const id = computed(() => String(route.params.id))
const tab = computed<Tab>({
  get: () => (TABS.includes(route.query.tab as Tab) ? (route.query.tab as Tab) : 'overview'),
  set: (v) => void router.replace({ query: { ...route.query, tab: v, welcome: undefined } }),
})
const c = computed(() => detail.value?.campaign)

async function load(): Promise<void> {
  try {
    detail.value = await googleAdsUserApi.detail(id.value)
    loadError.value = ''
  } catch (e) {
    loadError.value = e instanceof ApiError && e.status === 404 ? t('ads.dash.notFound') : t('ads.dash.loadError')
  }
  clearTimeout(poll)
  // While a cycle runs, keep the numbers fresh.
  if (detail.value?.runningCycle) poll = setTimeout(() => void load(), 5000)
}

async function sync(): Promise<void> {
  if (syncing.value) return
  syncing.value = true
  try {
    const r = await googleAdsUserApi.sync(id.value)
    if (!r.synced) toasts.info(t('ads.dash.syncRecent'))
    await load()
  } catch (e) {
    toasts.error(e instanceof ApiError && e.message === 'google_ads_reconnect_required' ? t('ads.dash.reconnectNeeded') : t('ads.dash.syncError'))
  } finally {
    syncing.value = false
  }
}

async function reconnect(): Promise<void> {
  try {
    const { url } = await googleAdsUserApi.reconnectUrl(id.value)
    window.location.href = url
  } catch {
    toasts.error(t('ads.connect.error'))
  }
}

function onRemoved(): void {
  void adsStore.fetch(true)
  void router.replace({ name: 'dashboard' })
}

watch(id, () => {
  detail.value = null
  void load()
})
onMounted(() => {
  if (route.query.reconnected) toasts.success(t('ads.dash.reconnected'))
  void load()
  void adsStore.fetch()
})
onBeforeUnmount(() => clearTimeout(poll))
</script>

<template>
  <v-container class="ad" fluid>
    <p v-if="loadError" class="ab-note ab-note--warn">
      <v-icon icon="mdi-alert-circle-outline" size="18" /> {{ loadError }}
    </p>
    <div v-else-if="!detail" class="ab-center"><v-progress-circular indeterminate color="primary" /></div>

    <template v-else-if="c">
      <AdminPageHeader :eyebrow="`Google Ads${c.customerName ? ` · ${c.customerName}` : ''}`" :title="c.name">
        <template #actions>
          <v-btn variant="tonal" prepend-icon="mdi-cloud-sync-outline" :loading="syncing" :disabled="c.status === 'disconnected'" @click="sync">
            {{ t('ads.dash.sync') }}
          </v-btn>
          <v-btn color="primary" prepend-icon="mdi-robot-outline" :disabled="c.status !== 'active'" @click="tab = 'agent'">
            {{ t('ads.dash.optimize') }}
          </v-btn>
        </template>
      </AdminPageHeader>

      <div class="ad__status">
        <GaChip :tone="c.status === 'active' ? 'success' : c.status === 'paused' ? 'neutral' : 'error'">
          {{ t(`ads.campaignStatus.${c.status}`) }}
        </GaChip>
        <GaChip :tone="strengthTone(c.adStrength)">Ad Strength: {{ t(`ads.strength.${c.adStrength ?? 'UNKNOWN'}`, c.adStrength ?? '–') }}</GaChip>
        <span class="ad__meta">{{ t('ads.dash.synced', { when: dateTime(c.syncedAt, locale) }) }}</span>
        <span v-if="c.nextCycleAt" class="ad__meta">{{ t('ads.dash.nextCycle', { when: dateTime(c.nextCycleAt, locale) }) }}</span>
        <span v-if="detail.connection?.googleEmail" class="ad__meta">
          <v-icon icon="mdi-google" size="13" /> {{ detail.connection.googleEmail }}
        </span>
      </div>

      <div v-if="c.status === 'disconnected'" class="ab-note ab-note--warn ad__banner">
        <v-icon icon="mdi-link-variant-off" size="18" />
        <span>{{ t('ads.dash.disconnected') }}</span>
        <v-btn size="small" color="primary" class="ml-auto" @click="reconnect">{{ t('ads.dash.reconnect') }}</v-btn>
      </div>
      <div v-else-if="welcome" class="ab-note ad__banner" data-guide="ads-welcome">
        <v-icon icon="mdi-party-popper" size="18" />
        <span>{{ t('ads.dash.welcome', { min: detail.pricing.minCredits }) }}</span>
        <v-btn size="small" variant="text" class="ml-auto" icon="mdi-close" :aria-label="t('common.close')" @click="welcome = false" />
      </div>

      <v-tabs v-model="tab" color="primary" show-arrows density="comfortable" class="ad__tabs" data-guide="ads-tabs">
        <v-tab value="overview">{{ t('ads.tab.overview') }}</v-tab>
        <v-tab value="agent">{{ t('ads.tab.agent') }}</v-tab>
        <v-tab value="chat">{{ t('ads.tab.chat') }}</v-tab>
        <v-tab value="proposals">
          {{ t('ads.tab.proposals') }}
          <span v-if="detail.pending.length" class="ad__count">{{ detail.pending.length }}</span>
        </v-tab>
        <v-tab value="settings">{{ t('ads.tab.settings') }}</v-tab>
        <v-tab value="costs">{{ t('ads.tab.costs') }}</v-tab>
      </v-tabs>

      <div class="ad__body">
        <AdsOverviewTab v-if="tab === 'overview'" :detail="detail" @goto="(v) => (tab = v as Tab)" />
        <AdsAgentTab v-else-if="tab === 'agent'" :detail="detail" @changed="load" @goto="(v) => (tab = v as Tab)" />
        <AdsChatTab v-else-if="tab === 'chat'" :detail="detail" @changed="load" />
        <AdsProposalsTab v-else-if="tab === 'proposals'" :detail="detail" @changed="load" />
        <AdsSettingsTab v-else-if="tab === 'settings'" :detail="detail" @changed="load" @removed="onRemoved" />
        <AdsCostsTab v-else :detail="detail" />
      </div>
    </template>
  </v-container>
</template>

<style scoped>
.ad {
  max-width: 1200px;
}
.ad__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.9rem;
  margin: -0.75rem 0 1.1rem;
}
.ad__meta {
  display: inline-flex;
  min-width: 0;
  overflow-wrap: anywhere;
  align-items: center;
  gap: 0.25rem;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.ad__banner {
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 1rem;
}
.ad__banner > span {
  flex: 1 1 12rem;
  min-width: 0;
}
.ad__tabs {
  border-bottom: 1px solid var(--tvz-hairline);
}
.ad__count {
  margin-left: 0.4rem;
  min-width: 1.3rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  color: #fff;
  background: rgb(var(--v-theme-warning));
}
.ad__body {
  padding-top: 1.5rem;
}
</style>
