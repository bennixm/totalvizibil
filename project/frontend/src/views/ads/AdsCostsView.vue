<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import { creditsOf } from '@/components/ads/format'
import '@/components/ads/ads.css'
import { googleAdsUserApi, type AdsCosts } from '@/services/googleAdsUser'

/** What the Google Ads agent cost, per campaign: optimizations and chat. */
const { t, locale } = useI18n()

const PERIODS = ['month', 'last', 'all'] as const
type Period = (typeof PERIODS)[number]
const period = ref<Period>('month')
const data = ref<AdsCosts | null>(null)
const failed = ref(false)
let seq = 0

const day = (d: Date) => d.toISOString().slice(0, 10)
function range(p: Period): [string?, string?] {
  const now = new Date()
  if (p === 'all') return []
  if (p === 'month') return [day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)))]
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
  return [day(start), day(end)]
}

async function load(): Promise<void> {
  const mine = ++seq
  try {
    const res = await googleAdsUserApi.costs(...range(period.value))
    if (mine !== seq) return
    data.value = res
    failed.value = false
  } catch {
    if (mine === seq) failed.value = true
  }
}
function pick(p: Period): void {
  if (period.value === p) return
  period.value = p
  void load()
}
onMounted(load)

const rows = computed(() => (data.value?.items ?? []).filter((r) => r.cycles || r.messages))
const totals = computed(() => {
  const x = data.value?.totals
  return x
    ? [
        { key: 'total', label: t('ads.costs.total'), minor: x.totalMinor, strong: true },
        { key: 'cycles', label: t('ads.costs.cycles'), minor: x.cyclesMinor },
        { key: 'chat', label: t('ads.costs.chat'), minor: x.chatMinor },
        { key: 'returned', label: t('ads.cost.returned'), minor: x.returnedMinor },
      ]
    : []
})
const cr = (minor: number) => creditsOf(minor, locale.value)
</script>

<template>
  <v-container class="ac" fluid>
    <AdminPageHeader eyebrow="Google Ads" :title="t('ads.costs.title')" :hint="t('ads.costs.lead')" />

    <div class="ac__periods" role="group" :aria-label="t('ads.costs.title')">
      <button
        v-for="p in PERIODS"
        :key="p"
        type="button"
        class="ac__period"
        :class="{ 'is-on': period === p }"
        :aria-pressed="period === p"
        @click="pick(p)"
      >
        {{ t(`ads.costs.period.${p}`) }}
      </button>
    </div>

    <p v-if="failed" class="ab-note ab-note--warn">
      <v-icon icon="mdi-alert-circle-outline" size="18" />
      <span>{{ t('ads.dash.loadError') }}</span>
      <v-btn size="small" variant="text" @click="load">{{ t('common.retry') }}</v-btn>
    </p>
    <div v-else-if="!data" class="ab-center"><v-progress-circular indeterminate color="primary" /></div>
    <template v-else>
      <div class="ac__totals">
        <div v-for="x in totals" :key="x.key" class="ac__total" :class="{ 'is-strong': x.strong }">
          <span>{{ x.label }}</span>
          <b>{{ cr(x.minor) }}</b>
          <small>{{ t('ads.credits') }}</small>
        </div>
      </div>

      <p v-if="!rows.length" class="ab-note">
        <v-icon icon="mdi-cash-off" size="18" /> <span>{{ t('ads.costs.none') }}</span>
      </p>
      <div v-else class="ac__table">
        <div class="ac__head" aria-hidden="true">
          <span>{{ t('ads.costs.colCampaign') }}</span>
          <span class="num">{{ t('ads.costs.cycles') }}</span>
          <span class="num">{{ t('ads.costs.chat') }}</span>
          <span class="num">{{ t('ads.costs.total') }}</span>
        </div>
        <component
          :is="r.removed ? 'div' : 'RouterLink'"
          v-for="r in rows"
          :key="r.id"
          class="ac__row"
          :class="{ 'is-removed': r.removed }"
          v-bind="r.removed ? {} : { to: { name: 'ads-dashboard', params: { id: r.id }, query: { tab: 'history' } } }"
        >
          <span class="ac__name">
            <span class="ac__icon"><v-icon icon="mdi-bullhorn-outline" size="18" /></span>
            <span class="ac__nameText">
              <b>{{ r.name }}</b>
              <small v-if="r.removed">{{ t('ads.costs.removed') }}</small>
            </span>
          </span>
          <span class="num" :data-label="t('ads.costs.cycles')">
            <b>{{ cr(r.cyclesMinor) }}</b>
            <small>{{ t('ads.costs.cyclesN', r.cycles) }}</small>
          </span>
          <span class="num" :data-label="t('ads.costs.chat')">
            <b>{{ cr(r.chatMinor) }}</b>
            <small>{{ t('ads.costs.chatN', r.messages) }}</small>
          </span>
          <span class="num ac__sum" :data-label="t('ads.costs.total')">
            <b>{{ cr(r.cyclesMinor + r.chatMinor) }}</b>
            <small>{{ t('ads.credits') }}</small>
          </span>
        </component>
      </div>

      <p class="ab-note ac__foot">
        <v-icon icon="mdi-wallet-outline" size="18" />
        <span>
          {{ t('ads.cost.walletNote') }}
          <RouterLink :to="{ name: 'wallet-transactions' }">{{ t('ads.costs.allTransactions') }}</RouterLink>
        </span>
      </p>
    </template>
  </v-container>
</template>

<style scoped>
.ac__periods {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 1rem;
}
.ac__period {
  padding: 0.35rem 0.8rem;
  border: 1px solid var(--tvz-hairline);
  clip-path: var(--tvz-hex-sm);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.75);
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  cursor: pointer;
  transition: background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.ac__period:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.ac__period.is-on {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}
.ac__totals {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.6rem;
  margin-bottom: 1rem;
}
.ac__total {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.85rem 1rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
}
.ac__total span {
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.ac__total b {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.35rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.ac__total small {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.ac__total.is-strong {
  border-color: rgba(var(--v-theme-primary), 0.45);
  background: rgba(var(--v-theme-primary), 0.08);
}
.ac__total.is-strong b {
  color: rgb(var(--v-theme-primary));
}
.ac__table {
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
  margin-bottom: 1rem;
}
.ac__head,
.ac__row {
  display: grid;
  grid-template-columns: minmax(0, 2.2fr) repeat(3, minmax(92px, 1fr));
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
}
.ac__head {
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(var(--v-theme-on-surface), 0.5);
  border-bottom: 1px solid var(--tvz-hairline);
}
.ac__row {
  color: inherit;
  text-decoration: none;
  transition: background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.ac__row + .ac__row {
  border-top: 1px solid var(--tvz-hairline);
}
a.ac__row:hover,
a.ac__row:focus-visible {
  background: rgba(var(--v-theme-primary), 0.05);
  outline: none;
}
.ac__name {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
}
.ac__icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
}
.ac__row.is-removed .ac__icon {
  color: rgba(var(--v-theme-on-surface), 0.45);
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.ac__nameText {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.ac__nameText b {
  font-size: var(--tvz-fs-body);
  font-weight: 600;
  overflow-wrap: anywhere;
}
.ac__nameText small,
.num small {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.num {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  text-align: right;
}
.num b {
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.ac__sum b {
  font-size: var(--tvz-fs-body);
  color: rgb(var(--v-theme-primary));
}
.ac__foot a {
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}
@media (max-width: 720px) {
  .ac__totals {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .ac__head {
    display: none;
  }
  .ac__row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .ac__name {
    grid-column: 1 / -1;
  }
  .num {
    align-items: flex-start;
    text-align: left;
  }
  .num::before {
    content: attr(data-label);
    font-size: var(--tvz-fs-micro);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(var(--v-theme-on-surface), 0.5);
  }
}
</style>
