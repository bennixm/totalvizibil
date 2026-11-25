<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import { creditsOf } from '@/components/ads/format'
import '@/components/ads/ads.css'
import { googleAdsUserApi, type AdsCosts } from '@/services/googleAdsUser'

/** What the Google Ads agent cost, per campaign: optimizations and chat. */
const { t, locale } = useI18n()

type Period = 'month' | 'last' | 'all'
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
  period.value = p
  void load()
}
onMounted(load)

const rows = computed(() => (data.value?.items ?? []).filter((r) => r.cycles || r.messages))
const cr = (minor: number) => `${creditsOf(minor, locale.value)} ${t('ads.credits')}`
</script>

<template>
  <v-container class="ac" fluid>
    <AdminPageHeader eyebrow="Google Ads" :title="t('ads.costs.title')" :hint="t('ads.costs.lead')" />

    <div class="ac__periods" role="group">
      <v-btn
        v-for="p in ['month', 'last', 'all'] as const"
        :key="p"
        size="small"
        :variant="period === p ? 'flat' : 'tonal'"
        :color="period === p ? 'primary' : undefined"
        @click="pick(p)"
      >
        {{ t(`ads.costs.period.${p}`) }}
      </v-btn>
    </div>

    <p v-if="failed" class="ab-note ab-note--warn">
      <v-icon icon="mdi-alert-circle-outline" size="18" /> {{ t('ads.dash.loadError') }}
      <v-btn size="small" variant="text" @click="load">{{ t('common.retry') }}</v-btn>
    </p>
    <div v-else-if="!data" class="ab-center"><v-progress-circular indeterminate color="primary" /></div>
    <template v-else>
      <div class="ac__totals">
        <div class="ab-card"><span>{{ t('ads.costs.total') }}</span><b>{{ cr(data.totals.totalMinor) }}</b></div>
        <div class="ab-card"><span>{{ t('ads.costs.cycles') }}</span><b>{{ cr(data.totals.cyclesMinor) }}</b></div>
        <div class="ab-card"><span>{{ t('ads.costs.chat') }}</span><b>{{ cr(data.totals.chatMinor) }}</b></div>
        <div class="ab-card"><span>{{ t('ads.cost.returned') }}</span><b>{{ cr(data.totals.returnedMinor) }}</b></div>
      </div>

      <p v-if="!rows.length" class="ab-note"><v-icon icon="mdi-cash-off" size="18" /> {{ t('ads.costs.none') }}</p>
      <ul v-else class="ac__list">
        <li v-for="r in rows" :key="r.id" class="ab-card ac__row">
          <div class="ac__name">
            <RouterLink v-if="!r.removed" :to="{ name: 'ads-dashboard', params: { id: r.id }, query: { tab: 'history' } }">{{ r.name }}</RouterLink>
            <span v-else>{{ r.name }} <small>({{ t('ads.costs.removed') }})</small></span>
          </div>
          <span>{{ t('ads.costs.cyclesN', { n: r.cycles }) }}: <b>{{ cr(r.cyclesMinor) }}</b></span>
          <span>{{ t('ads.costs.chatN', { n: r.messages }) }}: <b>{{ cr(r.chatMinor) }}</b></span>
        </li>
      </ul>
      <p class="ab-note">
        <v-icon icon="mdi-wallet-outline" size="18" /> {{ t('ads.cost.walletNote') }}
        <RouterLink :to="{ name: 'wallet-transactions' }">{{ t('ads.costs.allTransactions') }}</RouterLink>
      </p>
    </template>
  </v-container>
</template>

<style scoped>
.ac__periods {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.ac__totals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.ac__totals > div {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.ac__totals span {
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-size: var(--tvz-fs-sm, 0.85rem);
}
.ac__list {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.ac__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1.5rem;
}
.ac__name {
  flex: 1 1 200px;
  min-width: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}
</style>
