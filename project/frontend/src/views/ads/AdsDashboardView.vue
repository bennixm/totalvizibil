<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import GaChip from '@/components/admin/google-ads/GaChip.vue'
import AdsOverviewTab from '@/components/ads/AdsOverviewTab.vue'
import AdsHomeTab from '@/components/ads/AdsHomeTab.vue'
import AdsHistoryTab from '@/components/ads/AdsHistoryTab.vue'
import AdsChatTab from '@/components/ads/AdsChatTab.vue'
import AdsProposalsTab from '@/components/ads/AdsProposalsTab.vue'
import AdsSettingsTab from '@/components/ads/AdsSettingsTab.vue'
import { dateTime } from '@/components/ads/format'
import '@/components/ads/ads.css'
import { ApiError } from '@/services/api'
import { useToastStore } from '@/stores/toast'
import { useGoogleAdsUserStore } from '@/stores/googleAdsUser'
import { googleAdsUserApi, type UserCampaignDetail } from '@/services/googleAdsUser'

/**
 * Pages of ONE customer Google Ads campaign. The default one (home) shows the
 * single next step in plain words; the technical view is the last section.
 */
const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const toasts = useToastStore()
const adsStore = useGoogleAdsUserStore()
const { mdAndUp } = useDisplay()

const TABS = ['home', 'chat', 'proposals', 'history', 'settings', 'overview'] as const
type Tab = (typeof TABS)[number]
/** Links saved before the sections were merged. */
const OLD_TABS: Record<string, Tab> = { agent: 'home', costs: 'history' }

const detail = ref<UserCampaignDetail | null>(null)
const loadError = ref('')
const syncing = ref(false)
const welcome = ref(route.query.welcome === '1')
let poll: ReturnType<typeof setTimeout> | undefined

const id = computed(() => String(route.params.id))
const tab = computed<Tab>({
  get: () => {
    const q = String(route.query.tab ?? '')
    return TABS.includes(q as Tab) ? (q as Tab) : (OLD_TABS[q] ?? 'home')
  },
  set: (v) => void router.replace({ query: { ...route.query, tab: v, welcome: undefined } }),
})
const c = computed(() => detail.value?.campaign)

async function load(): Promise<void> {
  try {
    const forId = id.value
    const next = await googleAdsUserApi.detail(forId)
    // Switched campaign meanwhile: that load owns the page now.
    if (forId !== id.value) return
    const finished = detail.value?.campaign.id === forId && detail.value.runningCycle && !next.runningCycle
    detail.value = next
    loadError.value = ''
    if (finished) announce(next)
  } catch (e) {
    loadError.value = e instanceof ApiError && e.status === 404 ? t('ads.dash.notFound') : t('ads.dash.loadError')
  }
  clearTimeout(poll)
  // While a cycle runs, keep the numbers fresh.
  if (detail.value?.runningCycle) poll = setTimeout(() => void load(), 5000)
}

/** Tells the owner how the cycle they were watching ended. */
function announce(d: UserCampaignDetail): void {
  const x = d.cycles[0]
  if (!x) return
  if (!x.tasksApplied && !x.tasksProposed) toasts.info(t('ads.home.lastReturned'))
  else toasts.success(t('ads.home.lastDone', { applied: x.tasksApplied, proposed: x.tasksProposed }))
  void adsStore.fetch(true)
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

/** Approvals and statuses also show in the sidebar and the campaign list. */
function onChanged(): void {
  void load()
  void adsStore.fetch(true)
}

function onRemoved(): void {
  void adsStore.fetch(true)
  void router.replace({ name: 'ads-home' })
}

watch(id, () => {
  detail.value = null
  void load()
})
onMounted(() => {
  const old = OLD_TABS[String(route.query.tab ?? '')]
  if (old) tab.value = old
  if (route.query.reconnected) toasts.success(t('ads.dash.reconnected'))
  void load()
  void adsStore.fetch()
})
onBeforeUnmount(() => clearTimeout(poll))
</script>

<template>
  <v-container class="ad" fluid>
    <div v-if="loadError" class="ab-note ab-note--warn">
      <v-icon icon="mdi-alert-circle-outline" size="18" />
      <span>{{ loadError }}</span>
      <v-btn size="small" variant="tonal" class="ml-auto" :to="{ name: 'ads-home' }">{{ t('nav.adsAll') }}</v-btn>
    </div>
    <div v-else-if="!detail" class="ab-center"><v-progress-circular indeterminate color="primary" /></div>

    <template v-else-if="c">
      <AdminPageHeader :eyebrow="`Google Ads${c.customerName ? ` · ${c.customerName}` : ''}`" :title="c.name">
        <template #actions>
          <v-btn variant="tonal" prepend-icon="mdi-refresh" :loading="syncing" :disabled="c.status === 'disconnected'" @click="sync">
            {{ t('ads.dash.sync') }}
          </v-btn>
        </template>
      </AdminPageHeader>

      <div class="ad__status">
        <GaChip :tone="c.status === 'active' ? 'success' : c.status === 'paused' ? 'neutral' : 'error'">
          {{ t(`ads.campaignStatus.${c.status}`) }}
        </GaChip>
        <span class="ad__meta">{{ t('ads.dash.synced', { when: dateTime(c.syncedAt, locale) }) }}</span>
        <span v-if="c.nextCycleAt" class="ad__meta">{{ t('ads.dash.nextCycle', { when: dateTime(c.nextCycleAt, locale) }) }}</span>
        <span v-if="detail.connection?.googleEmail" class="ad__meta">
          <v-icon icon="mdi-google" size="13" /> {{ detail.connection.googleEmail }}
        </span>
      </div>

      <div v-if="c.status === 'disconnected' && tab !== 'home'" class="ab-note ab-note--warn ad__banner">
        <v-icon icon="mdi-link-variant-off" size="18" />
        <span>{{ t('ads.dash.disconnected') }}</span>
        <v-btn size="small" color="primary" class="ml-auto" @click="reconnect">{{ t('ads.dash.reconnect') }}</v-btn>
      </div>
      <div v-else-if="welcome && c.status !== 'disconnected'" class="ab-note ad__banner" data-guide="ads-welcome">
        <v-icon icon="mdi-party-popper" size="18" />
        <span>{{ t('ads.dash.welcome', { min: detail.pricing.minCredits }) }}</span>
        <v-btn size="small" variant="text" class="ml-auto" icon="mdi-close" :aria-label="t('common.close')" @click="welcome = false" />
      </div>

      <!-- On desktop the sidebar lists the same sections. -->
      <v-tabs v-if="!mdAndUp" v-model="tab" color="primary" show-arrows density="comfortable" class="ad__tabs" data-guide="ads-tabs">
        <v-tab v-for="v in TABS" :key="v" :value="v">
          {{ t(`ads.tab.${v}`) }}
          <span v-if="v === 'proposals' && detail.pending.length" class="ad__count">{{ detail.pending.length }}</span>
        </v-tab>
      </v-tabs>

      <div class="ad__body">
        <AdsHomeTab
          v-if="tab === 'home'"
          :detail="detail"
          @changed="onChanged"
          @goto="(v) => (tab = v as Tab)"
          @reconnect="reconnect"
          @sync="sync"
        />
        <AdsOverviewTab v-else-if="tab === 'overview'" :detail="detail" @goto="(v) => (tab = v as Tab)" />
        <AdsHistoryTab v-else-if="tab === 'history'" :detail="detail" @changed="onChanged" />
        <AdsChatTab v-else-if="tab === 'chat'" :detail="detail" @changed="onChanged" />
        <AdsProposalsTab v-else-if="tab === 'proposals'" :detail="detail" @changed="onChanged" />
        <AdsSettingsTab v-else :detail="detail" @changed="onChanged" @removed="onRemoved" />
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
