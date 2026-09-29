<script setup lang="ts">
/**
 * Detailed lifetime spend for ONE business — clicks / AI usage / the
 * builder's one-time unlock fee / everything else, plus the underlying
 * transactions. The dashboard's own "Business spend" card shows the same
 * total (see `/wallet/spend-breakdown`); this page is the "where did it go"
 * detail view for it.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import { apiFetch } from '@/services/api'
import { useMoney } from '@/composables/useMoney'
import { useCompaniesStore } from '@/stores/companies'
import { useWalletStore } from '@/stores/wallet'

const { t, n } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const walletStore = useWalletStore()
const { transactions, nextCursor, loading: txnLoading } = storeToRefs(walletStore)
const money = useMoney()

const companyId = ref<string | null>(null)
const loading = ref(true)
const error = ref('')

interface CategoryRow {
  key: 'clicks' | 'aiUsage' | 'builderUnlock' | 'other'
  total: { minor: number; credits: number }
  count: number
}
interface Breakdown {
  total: { minor: number; credits: number }
  categories: CategoryRow[]
}
const breakdown = ref<Breakdown | null>(null)

const CATEGORY_META: Record<CategoryRow['key'], { icon: string; labelKey: string }> = {
  clicks: { icon: 'mdi-cursor-default-click-outline', labelKey: 'consumption.clicks' },
  aiUsage: { icon: 'mdi-robot-outline', labelKey: 'consumption.aiUsage' },
  builderUnlock: { icon: 'mdi-rocket-launch-outline', labelKey: 'consumption.builderUnlock' },
  other: { icon: 'mdi-dots-horizontal', labelKey: 'consumption.other' },
}
const visibleCategories = computed(() => breakdown.value?.categories ?? [])

function cr(v: number): string {
  return n(v, { maximumFractionDigits: 2 }) + ' cr'
}

async function loadFor(id: string): Promise<void> {
  companyId.value = id
  loading.value = true
  error.value = ''
  try {
    breakdown.value = await apiFetch<Breakdown>(`/wallet/spend-breakdown?companyId=${id}`)
    await walletStore.loadTransactions(false, { companyId: id, type: 'spend' })
  } catch {
    error.value = t('consumption.loadError')
  } finally {
    loading.value = false
  }
}

async function loadMore(): Promise<void> {
  if (!nextCursor.value) return
  await walletStore.loadTransactions(true)
}

function txnLabel(txn: (typeof transactions.value)[number]): string {
  if (txn.provider === 'cpc' && txn.clicks) {
    return t('consumption.txnClicks', { n: txn.clicks })
  }
  return txn.description ?? t('consumption.txnOther')
}

onMounted(async () => {
  await companies.fetchOverview().catch(() => {})
  const id = companies.resolveId(route.query.c)
  if (!id) {
    void router.replace({ name: 'dashboard' })
    return
  }
  await loadFor(id)
})

watch(
  () => route.query.c,
  (raw) => {
    const next = typeof raw === 'string' ? raw : null
    if (next && next !== companyId.value) void loadFor(next)
  },
)
</script>

<template>
  <v-container class="cons">
    <header class="cons__head">
      <p class="cons__eyebrow">{{ t('consumption.eyebrow') }}</p>
      <h1>{{ t('consumption.title') }}</h1>
    </header>

    <div v-if="loading && !breakdown" class="cons__center">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <div v-else-if="error" class="cons__error">
      <v-icon icon="mdi-alert-circle-outline" size="16" /> {{ error }}
    </div>

    <template v-else-if="breakdown">
      <section class="cons__total card">
        <span class="cons__totalLabel">{{ t('consumption.totalLabel') }}</span>
        <strong class="cons__totalValue">{{ cr(breakdown.total.credits) }}</strong>
        <span class="cons__totalApprox">{{ money.approx(breakdown.total.credits) }}</span>
      </section>

      <section class="cons__grid">
        <div v-for="c in visibleCategories" :key="c.key" class="cons__card">
          <span class="cons__cardIcon"><v-icon :icon="CATEGORY_META[c.key].icon" size="18" /></span>
          <span class="cons__cardLabel">{{ t(CATEGORY_META[c.key].labelKey) }}</span>
          <strong class="cons__cardValue">{{ cr(c.total.credits) }}</strong>
          <span class="cons__cardCount">
            {{ c.count ? t('consumption.txnCount', { n: c.count }) : t('consumption.none') }}
          </span>
        </div>
      </section>

      <section class="card cons__list">
        <h3>{{ t('consumption.recentTitle') }}</h3>
        <p v-if="!transactions.length" class="cons__empty">{{ t('consumption.empty') }}</p>
        <ul v-else class="cons__rows">
          <li v-for="txn in transactions" :key="txn.id" class="crow">
            <div class="crow__main">
              <p class="crow__label">{{ txnLabel(txn) }}</p>
              <p class="crow__date">{{ new Date(txn.createdAt).toLocaleString() }}</p>
            </div>
            <span class="crow__amount">{{ cr(Math.abs(txn.amount.credits)) }}</span>
          </li>
        </ul>
        <button
          v-if="nextCursor"
          type="button"
          class="cons__more"
          :disabled="txnLoading"
          @click="loadMore"
        >
          {{ t('consumption.loadMore') }}
        </button>
      </section>
    </template>
  </v-container>
</template>

<style scoped>
.cons {
  max-width: 680px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.cons__head {
  margin-bottom: 1.25rem;
}
.cons__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin: 0 0 0.3rem;
}
.cons__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.5rem, 4vw, 2.1rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.cons__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.cons__error {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: rgb(var(--v-theme-error));
  font-size: 0.85rem;
}

.card {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  padding: 1.2rem 1.3rem;
}
.card h3 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.92rem;
  font-weight: 600;
  margin: 0 0 0.9rem;
}

.cons__total {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.15rem;
  margin-bottom: 1rem;
  background: rgba(var(--v-theme-primary), 0.06);
  border-color: rgba(var(--v-theme-primary), 0.25);
}
.cons__totalLabel {
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.cons__totalValue {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 2rem;
  font-weight: 700;
  color: rgb(var(--v-theme-primary));
}
.cons__totalApprox {
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.cons__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.7rem;
  margin-bottom: 1.25rem;
}
.cons__card {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.85rem 0.9rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
}
.cons__cardIcon {
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-bottom: 0.2rem;
}
.cons__cardLabel {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.cons__cardValue {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.15rem;
  font-variant-numeric: tabular-nums;
}
.cons__cardCount {
  font-size: 0.7rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.cons__list h3 {
  margin: 0 0 0.9rem;
}
.cons__empty {
  padding: 1.5rem 0;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.85rem;
}
.cons__rows {
  list-style: none;
  margin: 0;
  padding: 0;
}
.crow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem 0;
}
.crow + .crow {
  border-top: 1px solid var(--tvz-hairline);
}
.crow__main {
  min-width: 0;
}
.crow__label {
  margin: 0;
  font-size: 0.86rem;
  font-weight: 500;
}
.crow__date {
  margin: 0.1rem 0 0;
  font-size: 0.72rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.crow__amount {
  flex: none;
  font-size: 0.86rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.cons__more {
  display: block;
  width: 100%;
  margin-top: 0.75rem;
  padding: 0.6rem;
  border-radius: var(--tvz-radius-md);
  border: 1px solid var(--tvz-glass-border);
  font-size: 0.82rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.cons__more:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}

@media (max-width: 560px) {
  .cons__grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
