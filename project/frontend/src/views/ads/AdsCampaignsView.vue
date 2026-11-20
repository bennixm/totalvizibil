<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import AdsBuilderShell from '@/components/ads/AdsBuilderShell.vue'
import { ApiError } from '@/services/api'
import { useSeo } from '@/composables/useSeo'
import { useToastStore } from '@/stores/toast'
import {
  googleAdsUserApi,
  readDraftToken,
  type AdsAccount,
  type AdsCampaignListItem,
} from '@/services/googleAdsUser'

/**
 * Step 2: the connected Google user's real accounts and campaigns (live from
 * the Google Ads API, last 30 days). Picking one is free.
 */
const { t, n, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const toasts = useToastStore()
useSeo(() => ({ title: t('ads.campaigns.seoTitle'), canonicalPath: '/google-ads/campaigns' }))

const loading = ref(true)
const accounts = ref<AdsAccount[]>([])
const account = ref<AdsAccount | null>(null)
const campaigns = ref<AdsCampaignListItem[]>([])
const campaignsLoading = ref(false)
const picked = ref<string | null>(null)
const saving = ref(false)
const loadError = ref('')
const email = ref<string | null>(null)

const ERRORS = ['denied', 'access_denied', 'expired', 'state', 'scope', 'refresh', 'exchange']

function money(micros: number | string | null, currency: string | null): string {
  const v = Number(micros ?? 0) / 1e6
  try {
    return new Intl.NumberFormat(locale.value, {
      style: 'currency',
      currency: currency || 'EUR',
      maximumFractionDigits: v >= 100 ? 0 : 2,
    }).format(v)
  } catch {
    return n(v, { maximumFractionDigits: 2 })
  }
}

const supported = computed(() => campaigns.value.filter((c) => c.supported))

async function loadCampaigns(a: AdsAccount): Promise<void> {
  account.value = a
  picked.value = null
  campaignsLoading.value = true
  try {
    campaigns.value = await googleAdsUserApi.campaigns(a.customerId, a.loginCustomerId)
    if (supported.value.length === 1) picked.value = supported.value[0].id
  } catch (e) {
    campaigns.value = []
    toasts.error(e instanceof ApiError ? e.message : t('ads.campaigns.loadError'))
  } finally {
    campaignsLoading.value = false
  }
}

async function confirm(): Promise<void> {
  if (!account.value || !picked.value || saving.value) return
  saving.value = true
  try {
    await googleAdsUserApi.select({
      customerId: account.value.customerId,
      loginCustomerId: account.value.loginCustomerId,
      campaignId: picked.value,
    })
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

function statusTone(c: AdsCampaignListItem): string {
  if (c.status === 'ENABLED') return 'live'
  if (c.status === 'PAUSED') return 'idle'
  return 'idle'
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
    if (route.query.connected) {
      toasts.success(t('ads.campaigns.connected'))
      void router.replace({ query: {} })
    }
    accounts.value = await googleAdsUserApi.accounts()
    const previous = state.selected
      ? accounts.value.find((a) => a.customerId === state.selected!.customerId)
      : undefined
    const first = previous ?? (accounts.value.length === 1 ? accounts.value[0] : undefined)
    if (first) {
      await loadCampaigns(first)
      if (state.selected && previous) picked.value = state.selected.campaignId
    }
  } catch (e) {
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

    <div v-else-if="loadError" class="ab-card ag__narrow">
      <p class="ab-note ab-note--warn"><v-icon icon="mdi-alert-circle-outline" size="18" /> {{ loadError }}</p>
      <v-btn color="primary" :to="{ name: 'ads-connect' }">{{ t('ads.campaigns.reconnectCta') }}</v-btn>
    </div>

    <div v-else-if="!accounts.length" class="ab-card ag__narrow">
      <p class="ab-note ab-note--warn"><v-icon icon="mdi-account-search-outline" size="18" /> {{ t('ads.campaigns.noAccounts', { email: email ?? '' }) }}</p>
      <v-btn variant="tonal" :to="{ name: 'ads-connect' }">{{ t('ads.campaigns.otherAccount') }}</v-btn>
    </div>

    <div v-else class="ag">
      <!-- Accounts -->
      <section class="ag__accounts" data-guide="ads-accounts">
        <p class="ag__label">
          {{ t('ads.campaigns.accounts') }}
          <span v-if="email" class="ag__email">{{ email }}</span>
        </p>
        <button
          v-for="a in accounts"
          :key="a.customerId"
          type="button"
          class="acc"
          :class="{ 'is-on': account?.customerId === a.customerId }"
          @click="loadCampaigns(a)"
        >
          <v-icon icon="mdi-briefcase-outline" size="18" />
          <span class="acc__body">
            <span class="acc__name">{{ a.name }}</span>
            <span class="acc__meta">
              {{ a.customerId.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3') }}
              <template v-if="a.currencyCode"> · {{ a.currencyCode }}</template>
              <template v-if="a.loginCustomerId"> · {{ t('ads.campaigns.viaManager') }}</template>
              <template v-if="a.testAccount"> · {{ t('ads.campaigns.test') }}</template>
            </span>
          </span>
          <v-icon v-if="account?.customerId === a.customerId" icon="mdi-check" size="16" class="acc__chk" />
        </button>
      </section>

      <!-- Campaigns -->
      <section class="ag__campaigns" data-guide="ads-campaign-list">
        <p class="ag__label">{{ t('ads.campaigns.campaigns') }}</p>
        <div v-if="!account" class="ab-note"><v-icon icon="mdi-gesture-tap" size="18" /> {{ t('ads.campaigns.pickAccount') }}</div>
        <div v-else-if="campaignsLoading" class="ab-center"><v-progress-circular indeterminate color="primary" /></div>
        <p v-else-if="!campaigns.length" class="ab-note">
          <v-icon icon="mdi-information-outline" size="18" /> {{ t('ads.campaigns.none') }}
        </p>
        <template v-else>
          <label
            v-for="c in campaigns"
            :key="c.id"
            class="cmp"
            :class="{ 'is-on': picked === c.id, 'is-off': !c.supported }"
          >
            <input
              v-model="picked"
              type="radio"
              name="campaign"
              :value="c.id"
              :disabled="!c.supported"
              class="cmp__radio"
            />
            <span class="cmp__top">
              <span class="cmp__dot" :class="`t-${statusTone(c)}`" />
              <span class="cmp__name">{{ c.name }}</span>
              <span class="cmp__chip">{{ t(`ads.channel.${c.channelType}`, c.channelType) }}</span>
            </span>
            <span class="cmp__stats">
              <span><b>{{ n(c.last30.impressions) }}</b> {{ t('ads.metrics.impressions') }}</span>
              <span><b>{{ n(c.last30.clicks) }}</b> {{ t('ads.metrics.inline.clicks') }}</span>
              <span><b>{{ money(c.last30.costMicros, c.currencyCode) }}</b> {{ t('ads.metrics.inline.cost') }}</span>
              <span v-if="c.dailyBudgetMicros">
                <b>{{ money(c.dailyBudgetMicros, c.currencyCode) }}</b> {{ t('ads.metrics.perDay') }}
              </span>
            </span>
            <span class="cmp__foot">
              {{ t(`ads.status.${c.status}`, c.status) }} · {{ t('ads.campaigns.last30') }}
              <template v-if="!c.supported"> · {{ t('ads.campaigns.unsupportedShort') }}</template>
            </span>
          </label>
        </template>

        <v-btn
          color="primary"
          size="large"
          block
          class="mt-2"
          :disabled="!picked"
          :loading="saving"
          append-icon="mdi-arrow-right"
          data-guide="ads-campaign-continue"
          @click="confirm"
        >
          {{ t('ads.campaigns.continue') }}
        </v-btn>
      </section>
    </div>

    <div class="ab-back">
      <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" :to="{ name: 'ads-connect' }">
        {{ t('ads.back') }}
      </v-btn>
    </div>
  </AdsBuilderShell>
</template>

<style scoped>
.ag {
  display: grid;
  grid-template-columns: minmax(0, 300px) minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
}
.ag__narrow {
  max-width: 560px;
  margin-inline: auto;
}
.ag__accounts,
.ag__campaigns {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.ag__label {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.2rem 0.6rem;
  margin: 0 0 0.2rem;
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.ag__email {
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
}
.acc,
.cmp {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: var(--tvz-glass-bg);
  color: inherit;
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.acc {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.75rem 0.85rem;
}
.acc:hover,
.cmp:hover {
  border-color: rgba(var(--v-theme-primary), 0.4);
}
.acc.is-on,
.cmp.is-on {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.07);
}
.acc__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.acc__name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.acc__meta {
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.acc__chk {
  color: rgb(var(--v-theme-primary));
}
.cmp {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.85rem 1rem;
}
.cmp.is-off {
  opacity: 0.55;
  cursor: not-allowed;
}
.cmp__radio {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.cmp:has(.cmp__radio:focus-visible) {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
.cmp__top {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
.cmp__name {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cmp__chip {
  flex: none;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 600;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.cmp__dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), 0.3);
}
.cmp__dot.t-live {
  background: rgb(var(--v-theme-success));
}
.cmp__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem 1rem;
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.cmp__stats b {
  color: rgb(var(--v-theme-on-surface));
  font-variant-numeric: tabular-nums;
}
.cmp__foot {
  font-size: 0.74rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
@media (max-width: 760px) {
  .ag {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
