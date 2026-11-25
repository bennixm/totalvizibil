<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { ApiError } from '@/services/api'
import type { AdsAccount, AdsCampaignListItem, SelectionItem } from '@/services/googleAdsUser'

/**
 * Accounts on the left, campaigns of the open account on the right, with
 * multi-select across accounts (the selection survives switching account).
 * Shared by the builder's campaign step and "add campaigns" on an already
 * connected Google account; the parent supplies the loaders and decides
 * what "submit" does. Campaigns already in the panel (`managed`) are shown
 * but cannot be picked again.
 */
const props = defineProps<{
  accounts: AdsAccount[]
  loadCampaigns: (a: AdsAccount) => Promise<AdsCampaignListItem[]>
  email: string | null
  initial?: SelectionItem[]
  busy?: boolean
  switching?: boolean
  /** Show "use another Google account" (builder only). */
  canSwitch?: boolean
}>()
const emit = defineEmits<{
  (e: 'submit', items: SelectionItem[]): void
  (e: 'switch'): void
}>()
const { t, n, locale } = useI18n()

const account = ref<AdsAccount | null>(null)
const campaigns = ref<AdsCampaignListItem[]>([])
const loading = ref(false)
/** Why the open account's campaigns could not be read (never shown as "none"). */
const loadError = ref('')
/** key `${customerId}:${campaignId}` -> selection (+ name for the summary) */
const picked = ref(new Map<string, SelectionItem & { name: string }>())

const key = (customerId: string, campaignId: string) => `${customerId}:${campaignId}`
const count = computed(() => picked.value.size)
const pickable = (c: AdsCampaignListItem) => c.supported && !c.managed

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

function pickedIn(a: AdsAccount): number {
  let k = 0
  for (const s of picked.value.values()) if (s.customerId === a.customerId) k++
  return k
}

async function open(a: AdsAccount): Promise<void> {
  if (!a.selectable) return
  account.value = a
  campaigns.value = []
  loadError.value = ''
  loading.value = true
  // Another account may be opened before this one answers.
  const stale = () => account.value?.customerId !== a.customerId
  try {
    const list = await props.loadCampaigns(a)
    if (stale()) return
    campaigns.value = list
    // A single pickable campaign in the first opened account: pre-select it.
    const free = list.filter(pickable)
    if (!count.value && free.length === 1) toggle(free[0])
  } catch (e) {
    if (stale()) return
    const code = e instanceof ApiError ? e.message : ''
    loadError.value =
      code === 'customer_not_enabled'
        ? t('ads.campaigns.reason.not_enabled')
        : code === 'google_ads_not_connected' || code === 'google_ads_reconnect_required'
          ? t('ads.campaigns.reconnect')
          : code || t('ads.campaigns.loadError')
  } finally {
    if (!stale()) loading.value = false
  }
}

function toggle(c: AdsCampaignListItem): void {
  const a = account.value
  if (!a || !pickable(c)) return
  const k = key(a.customerId, c.id)
  const next = new Map(picked.value)
  if (next.has(k)) next.delete(k)
  else next.set(k, { customerId: a.customerId, loginCustomerId: a.loginCustomerId, campaignId: c.id, name: c.name })
  picked.value = next
}

function selectAll(): void {
  const a = account.value
  if (!a) return
  const next = new Map(picked.value)
  for (const c of campaigns.value.filter(pickable)) {
    next.set(key(a.customerId, c.id), { customerId: a.customerId, loginCustomerId: a.loginCustomerId, campaignId: c.id, name: c.name })
  }
  picked.value = next
}

function submit(): void {
  if (!count.value || props.busy) return
  emit(
    'submit',
    [...picked.value.values()].map(({ customerId, loginCustomerId, campaignId }) => ({
      customerId,
      loginCustomerId,
      campaignId,
    })),
  )
}

function statusTone(c: AdsCampaignListItem): string {
  return c.status === 'ENABLED' ? 'live' : 'idle'
}

onMounted(async () => {
  for (const s of props.initial ?? []) {
    picked.value.set(key(s.customerId, s.campaignId), { ...s, name: '' })
  }
  const selectable = props.accounts.filter((a) => a.selectable)
  const prev = props.initial?.[0]
    ? selectable.find((a) => a.customerId === props.initial![0].customerId)
    : undefined
  const first = prev ?? (selectable.length === 1 ? selectable[0] : undefined)
  if (first) await open(first)
})
</script>

<template>
  <div class="ag">
    <!-- Accounts -->
    <section class="ag__accounts" data-guide="ads-accounts">
      <p class="ag__label">{{ t('ads.campaigns.accounts') }}</p>
      <div class="ag__who">
        <v-icon icon="mdi-google" size="15" />
        <span class="ag__email">{{ email ?? t('ads.campaigns.connectedAccount') }}</span>
        <button v-if="canSwitch" type="button" class="ag__switch" :disabled="switching" @click="emit('switch')">
          {{ t('ads.campaigns.switchAccount') }}
        </button>
      </div>
      <button
        v-for="a in accounts"
        :key="a.customerId"
        type="button"
        class="acc"
        :class="{ 'is-on': account?.customerId === a.customerId, 'is-off': !a.selectable }"
        :disabled="!a.selectable"
        @click="open(a)"
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
          <span v-if="a.reason" class="acc__reason">{{ t(`ads.campaigns.reason.${a.reason}`, a.reason) }}</span>
        </span>
        <span v-if="pickedIn(a)" class="acc__count">{{ pickedIn(a) }}</span>
      </button>
    </section>

    <!-- Campaigns -->
    <section class="ag__campaigns" data-guide="ads-campaign-list">
      <div class="ag__head">
        <p class="ag__label">{{ t('ads.campaigns.campaigns') }}</p>
        <button
          v-if="account && campaigns.filter(pickable).length > 1"
          type="button"
          class="ag__switch"
          @click="selectAll"
        >
          {{ t('ads.campaigns.selectAll') }}
        </button>
      </div>
      <div v-if="!account" class="ab-note"><v-icon icon="mdi-gesture-tap" size="18" /> {{ t('ads.campaigns.pickAccount') }}</div>
      <div v-else-if="loading" class="ab-center"><v-progress-circular indeterminate color="primary" /></div>
      <p v-else-if="loadError" class="ab-note ab-note--warn">
        <v-icon icon="mdi-alert-circle-outline" size="18" /> <span class="ag__error">{{ loadError }}</span>
      </p>
      <p v-else-if="!campaigns.length" class="ab-note">
        <v-icon icon="mdi-information-outline" size="18" /> {{ t('ads.campaigns.none') }}
      </p>
      <template v-else>
        <label
          v-for="c in campaigns"
          :key="c.id"
          class="cmp"
          :class="{ 'is-on': picked.has(key(account.customerId, c.id)), 'is-off': !pickable(c) }"
        >
          <input
            type="checkbox"
            class="cmp__check"
            :checked="picked.has(key(account.customerId, c.id))"
            :disabled="!pickable(c)"
            @change="toggle(c)"
          />
          <span class="cmp__top">
            <span class="cmp__box" aria-hidden="true">
              <v-icon v-if="picked.has(key(account.customerId, c.id))" icon="mdi-check" size="14" />
            </span>
            <span class="cmp__dot" :class="`t-${statusTone(c)}`" />
            <span class="cmp__name" :title="c.name">{{ c.name }}</span>
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
            <template v-if="c.managed"> · <b class="cmp__managed">{{ t('ads.campaigns.alreadyManaged') }}</b></template>
            <template v-else-if="!c.supported"> · {{ t('ads.campaigns.unsupportedShort') }}</template>
          </span>
        </label>
      </template>

      <v-btn
        color="primary"
        size="large"
        block
        class="mt-2"
        :disabled="!count"
        :loading="busy"
        append-icon="mdi-arrow-right"
        data-guide="ads-campaign-continue"
        @click="submit"
      >
        {{ count > 1 ? t('ads.campaigns.continueN', { n: count }) : t('ads.campaigns.continue') }}
      </v-btn>
      <p v-if="count > 1" class="ag__hint">{{ t('ads.campaigns.multiHint') }}</p>
    </section>
  </div>
</template>

<style scoped>
.ag__error {
  min-width: 0;
  overflow-wrap: anywhere;
}
.ag {
  display: grid;
  grid-template-columns: minmax(0, 300px) minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
}
.ag__accounts,
.ag__campaigns {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.ag__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}
.ag__label {
  margin: 0 0 0.2rem;
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.ag__who {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.5rem;
  margin: -0.2rem 0 0.2rem;
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.ag__switch {
  border: 0;
  background: none;
  padding: 0.3rem 0;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
}
.ag__switch:disabled {
  opacity: 0.5;
}
.ag__email {
  min-width: 0;
  flex: 1 1 10rem;
  overflow-wrap: anywhere;
  font-weight: 500;
}
.ag__hint {
  margin: 0;
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
  text-align: center;
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
  overflow-wrap: anywhere;
}
.acc__meta,
.acc__reason {
  overflow-wrap: anywhere;
}
.acc__meta {
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.acc.is-off {
  opacity: 0.75;
  cursor: not-allowed;
}
.acc.is-off:hover {
  border-color: var(--tvz-glass-border);
}
.acc__reason {
  margin-top: 0.25rem;
  font-size: 0.75rem;
  line-height: 1.35;
  color: rgb(var(--v-theme-warning));
}
.acc__count {
  flex: none;
  min-width: 1.4rem;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
  text-align: center;
  color: #fff;
  background: rgb(var(--v-theme-primary));
}
.cmp {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.85rem 1rem;
}
.cmp.is-off {
  opacity: 0.6;
  cursor: not-allowed;
}
.cmp__check {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.cmp:has(.cmp__check:focus-visible) {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
.cmp__top {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
.cmp__box {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  flex: none;
  border-radius: 5px;
  border: 1.5px solid rgba(var(--v-theme-on-surface), 0.35);
  color: #fff;
}
.cmp.is-on .cmp__box {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary));
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
.cmp__managed {
  color: rgb(var(--v-theme-success));
}
@media (max-width: 760px) {
  /* Campaign names often differ only at the end: show them whole. */
  .cmp__top {
    flex-wrap: wrap;
  }
  .cmp__name {
    flex: 1 1 calc(100% - 60px);
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .ag {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
