<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import AdminHint from '@/components/admin/AdminHint.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import AdminSection from '@/components/admin/AdminSection.vue'
import GaChip from '@/components/admin/google-ads/GaChip.vue'
import GoogleAdsScoreRing from '@/components/admin/google-ads/GoogleAdsScoreRing.vue'
import AdsHistoryTab from '@/components/ads/AdsHistoryTab.vue'
import AdsOverviewTab from '@/components/ads/AdsOverviewTab.vue'
import AdsProposalsTab from '@/components/ads/AdsProposalsTab.vue'
import AdsRunPanel from '@/components/ads/AdsRunPanel.vue'
import AdsSettingsTab from '@/components/ads/AdsSettingsTab.vue'
import { ADS_API, type AdsApi } from '@/components/ads/adsApi'
import { dateTime } from '@/components/ads/format'
import '@/components/ads/ads.css'
import { adminUserAdsApi, type AdminAdsCampaign } from '@/services/adminUserAds'
import { ApiError } from '@/services/api'
import type { UserCampaignDetail } from '@/services/googleAdsUser'
import { useToastStore } from '@/stores/toast'
import AdminAdsEditor from './AdminAdsEditor.vue'

/**
 * One customer's Google Ads campaigns: the same sections the owner has
 * (through the staff API) plus direct edits of the campaign. The customer is
 * never charged for anything done here.
 */
const props = defineProps<{ userId: string }>()
const emit = defineEmits<{ (e: 'count', n: number): void }>()
const { t, locale } = useI18n()
const toasts = useToastStore()

const api = computed(() => adminUserAdsApi(props.userId))
// Stable object for the injected components, always the current user's API.
provide(ADS_API, new Proxy({} as AdsApi, { get: (_, k) => api.value[k as keyof AdsApi] }))

const campaigns = ref<AdminAdsCampaign[] | null>(null)
const error = ref('')
const openId = ref<string | null>(null)
const detail = ref<UserCampaignDetail | null>(null)
const TABS = ['overview', 'edit', 'proposals', 'settings', 'run', 'history'] as const
const tab = ref<(typeof TABS)[number]>('overview')
const syncing = ref(false)
let poll: ReturnType<typeof setTimeout> | undefined

async function load(): Promise<void> {
  try {
    campaigns.value = await api.value.list()
    error.value = ''
    emit('count', campaigns.value.length)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('admin.genericError')
  }
}
async function loadDetail(): Promise<void> {
  const id = openId.value
  clearTimeout(poll)
  if (!id) return
  try {
    const next = await api.value.detail(id)
    if (id !== openId.value) return
    detail.value = next
    if (next.runningCycle) poll = setTimeout(() => void loadDetail(), 5000)
  } catch (e) {
    if (id !== openId.value) return
    toasts.error(e instanceof ApiError ? e.message : t('admin.genericError'))
    openId.value = null
  }
}
function open(id: string): void {
  openId.value = id
  detail.value = null
  tab.value = 'overview'
  void loadDetail()
}
function close(): void {
  clearTimeout(poll)
  openId.value = null
  detail.value = null
  void load()
}
function changed(): void {
  void loadDetail()
  void load()
}
function goto(v: string): void {
  tab.value = v === 'home' ? 'run' : v === 'proposals' ? 'proposals' : 'settings'
}
async function sync(): Promise<void> {
  if (!openId.value || syncing.value) return
  syncing.value = true
  try {
    const r = await api.value.sync(openId.value)
    if (!r.synced) toasts.info(t('ads.dash.syncRecent'))
    changed()
  } catch (e) {
    toasts.error(e instanceof ApiError && e.message === 'google_ads_reconnect_required' ? t('ads.agent.disconnected') : t('ads.dash.syncError'))
  } finally {
    syncing.value = false
  }
}
const route = useRoute()
const adsQuery = () => (typeof route.query.ads === 'string' ? route.query.ads : '')
const tone = (s: string) => (s === 'active' ? 'success' : s === 'paused' ? 'neutral' : 'error')

watch(
  () => props.userId,
  () => {
    campaigns.value = null
    openId.value = null
    detail.value = null
    void load()
  },
)
onMounted(async () => {
  await load()
  // Deep link from the list of all campaigns.
  const id = adsQuery()
  if (id && campaigns.value?.some((c) => c.id === id)) open(id)
})
onBeforeUnmount(() => clearTimeout(poll))
</script>

<template>
  <AdminSection :title="openId ? undefined : t('admin.ads.tab')" icon="mdi-google-ads">
    <template v-if="!openId">
      <div v-if="!campaigns && !error" class="ga__center"><v-progress-circular indeterminate color="primary" /></div>
      <AdminEmptyState v-else-if="error" icon="mdi-alert-circle-outline" :text="error" />
      <AdminEmptyState v-else-if="!campaigns?.length" icon="mdi-google-ads" :text="t('admin.ads.none')" />
      <ul v-else class="ga__list">
        <li v-for="c in campaigns" :key="c.id" class="ga__row">
          <div class="ga__main">
            <b>{{ c.name }}</b>
            <small>
              {{ c.customerName ?? c.customerId }} · {{ c.googleEmail ?? '–' }} ·
              {{ t('ads.dash.synced', { when: dateTime(c.syncedAt, locale) }) }}
            </small>
          </div>
          <span v-if="c.score != null" class="ga__score">{{ c.score }}/100</span>
          <GaChip v-if="c.pendingApprovals" tone="warning">{{ t('ads.list.approve', { n: c.pendingApprovals }) }}</GaChip>
          <GaChip :tone="tone(c.status)">{{ t(`ads.campaignStatus.${c.status}`) }}</GaChip>
          <v-btn size="small" variant="tonal" color="primary" @click="open(c.id)">{{ t('admin.ads.manage') }}</v-btn>
        </li>
      </ul>
    </template>

    <template v-else>
      <header class="ga__head">
        <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" @click="close">{{ t('nav.adsAll') }}</v-btn>
        <v-btn v-if="detail" variant="tonal" size="small" prepend-icon="mdi-refresh" :loading="syncing" :disabled="detail.campaign.status === 'disconnected'" @click="sync">
          {{ t('ads.dash.sync') }}
        </v-btn>
      </header>
      <div v-if="!detail" class="ga__center"><v-progress-circular indeterminate color="primary" /></div>
      <template v-else>
        <div class="ga__title">
          <GoogleAdsScoreRing :score="detail.campaign.score" :size="56" :stroke="5" />
          <h2>{{ detail.campaign.name }} <AdminHint :text="t('admin.ads.notice')" /></h2>
          <GaChip :tone="tone(detail.campaign.status)">{{ t(`ads.campaignStatus.${detail.campaign.status}`) }}</GaChip>
        </div>
        <v-tabs v-model="tab" color="primary" show-arrows density="comfortable" class="ga__tabs">
          <v-tab v-for="v in TABS" :key="v" :value="v">
            {{ t(`admin.ads.tabs.${v}`) }}<template v-if="v === 'proposals' && detail.pending.length"> ({{ detail.pending.length }})</template>
          </v-tab>
        </v-tabs>
        <AdsOverviewTab v-if="tab === 'overview'" :detail="detail" @goto="goto" />
        <AdminAdsEditor v-else-if="tab === 'edit'" :user-id="userId" :campaign-id="detail.campaign.id" @changed="changed" />
        <AdsProposalsTab v-else-if="tab === 'proposals'" :detail="detail" @changed="changed" />
        <AdsSettingsTab v-else-if="tab === 'settings'" :detail="detail" @changed="changed" />
        <AdsRunPanel v-else-if="tab === 'run'" :detail="detail" @changed="changed" @goto="goto" />
        <AdsHistoryTab v-else :detail="detail" @changed="changed" />
      </template>
    </template>
  </AdminSection>
</template>

<style scoped>
.ga__center {
  display: grid;
  place-items: center;
  min-height: 160px;
}
.ga__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.ga__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.9rem;
  padding: 0.8rem 0;
  border-top: 1px solid var(--tvz-hairline);
}
.ga__row:first-child {
  border-top: 0;
}
.ga__main {
  flex: 1 1 14rem;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow-wrap: anywhere;
}
.ga__main small {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ga__score {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.ga__head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem;
}
.ga__title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  margin: 0.8rem 0;
}
.ga__title h2 {
  margin: 0;
  min-width: 0;
  font-size: 1.2rem;
  overflow-wrap: anywhere;
}
.ga__tabs {
  margin: 1rem 0 1.25rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
</style>
