<script setup lang="ts">
/**
 * Detailed lifetime spend for ONE business — the central place to see where
 * the budget went. Two clearly separated groups: campaign spend (clicks —
 * see CampaignSpendView, which no longer repeats this reporting) and
 * everything else (Website Builder AI usage, its one-time unlock fee,
 * anything not yet categorized) — plus a filterable list of the underlying
 * transactions. The dashboard's own "Business spend" card shows the same
 * grand total (see `/wallet/spend-breakdown`); this page is its detail view.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import TrendChart from '@/components/TrendChart.vue'
import { apiFetch } from '@/services/api'
import { useMoney } from '@/composables/useMoney'
import { useCompaniesStore } from '@/stores/companies'
import { useCampaignStore } from '@/stores/campaign'
import { useWalletStore, type SpendCategory } from '@/stores/wallet'

const { t, n } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const campaign = useCampaignStore()
const { spend: campaignSpend } = storeToRefs(campaign)
const walletStore = useWalletStore()
const { transactions, nextCursor, loading: txnLoading } = storeToRefs(walletStore)
const money = useMoney()

const companyId = ref<string | null>(null)
const loading = ref(true)
const error = ref('')

interface CategoryRow {
  key: SpendCategory
  total: { minor: number; credits: number }
  count: number
}
interface Breakdown {
  total: { minor: number; credits: number }
  categories: CategoryRow[]
}
const breakdown = ref<Breakdown | null>(null)

const CATEGORY_META: Record<SpendCategory, { icon: string; labelKey: string }> = {
  clicks: { icon: 'mdi-cursor-default-click-outline', labelKey: 'consumption.clicks' },
  aiUsage: { icon: 'mdi-robot-outline', labelKey: 'consumption.aiUsage' },
  builderUnlock: { icon: 'mdi-rocket-launch-outline', labelKey: 'consumption.builderUnlock' },
  other: { icon: 'mdi-dots-horizontal', labelKey: 'consumption.other' },
}
const CATEGORY_ORDER: SpendCategory[] = ['clicks', 'aiUsage', 'builderUnlock', 'other']
/** Matches `BUILDER_UNLOCK_DESCRIPTION` in `wallet.service.ts` — the fixed
 *  English description written to that one-time-fee ledger row. */
const BUILDER_UNLOCK_DESCRIPTION = 'Advanced website builder'

const categoryByKey = computed(() => {
  const map = new Map<SpendCategory, CategoryRow>()
  for (const c of breakdown.value?.categories ?? []) map.set(c.key, c)
  return map
})
const campaignCategory = computed(() => categoryByKey.value.get('clicks') ?? null)
/** Everything that isn't campaign/click spend — the "Other spend" section. */
const otherCategories = computed(() =>
  CATEGORY_ORDER.filter((k) => k !== 'clicks')
    .map((k) => categoryByKey.value.get(k))
    .filter((c): c is CategoryRow => !!c),
)

// Campaign spend trend — the same daily series CampaignSpendView used to
// chart itself; shown here instead so it isn't reported in two places.
const campaignChart = computed(() => {
  const pts = campaignSpend.value?.series ?? []
  return {
    labels: pts.map((p) => p.date.slice(5)),
    series: [{ label: t('consumption.campaignChartLegend'), values: pts.map((p) => p.spent) }],
  }
})
const hasCampaignHistory = computed(() => (campaignSpend.value?.series ?? []).some((p) => p.spent > 0))

function cr(v: number): string {
  return n(v, { maximumFractionDigits: 2 }) + ' cr'
}

// --- filters: which category + which date range the transaction list shows ---
const CATEGORY_FILTER_ITEMS = computed(() => [
  { value: '', title: t('consumption.filterAllTypes') },
  ...CATEGORY_ORDER.map((key) => ({ value: key, title: t(CATEGORY_META[key].labelKey) })),
])
const filterCategory = ref<'' | SpendCategory>('')
const filterFrom = ref('')
const filterTo = ref('')
const filterSearch = ref('')
const hasActiveFilters = computed(
  () => !!filterCategory.value || !!filterFrom.value || !!filterTo.value || !!filterSearch.value,
)

async function applyFilters(): Promise<void> {
  if (!companyId.value) return
  await walletStore.loadTransactions(false, {
    companyId: companyId.value,
    type: 'spend',
    category: filterCategory.value || null,
    from: filterFrom.value || null,
    to: filterTo.value || null,
    search: filterSearch.value || null,
  })
}
function clearFilters(): void {
  filterCategory.value = ''
  filterFrom.value = ''
  filterTo.value = ''
  filterSearch.value = ''
  void applyFilters()
}
// Typing a search term shouldn't fire a request per keystroke.
let searchDebounce: ReturnType<typeof setTimeout> | undefined
watch(filterSearch, () => {
  clearTimeout(searchDebounce)
  searchDebounce = setTimeout(applyFilters, 300)
})

/** A short, stable per-row reference — the underlying id is a full UUID.
 *  Matches what the id-search filter accepts (paste this back in, `#`
 *  included or not, and it matches). */
function shortId(id: string): string {
  return '#' + id.slice(0, 8)
}
/** Jump the list straight to one category — the summary cards double as filter shortcuts. */
function filterByCategory(key: SpendCategory): void {
  filterCategory.value = filterCategory.value === key ? '' : key
  void applyFilters()
}

async function loadFor(id: string): Promise<void> {
  companyId.value = id
  loading.value = true
  error.value = ''
  filterCategory.value = ''
  filterFrom.value = ''
  filterTo.value = ''
  filterSearch.value = ''
  try {
    const [b] = await Promise.all([
      apiFetch<Breakdown>(`/wallet/spend-breakdown?companyId=${id}`),
      campaign.loadSpend(id),
      walletStore.loadTransactions(false, { companyId: id, type: 'spend' }),
    ])
    breakdown.value = b
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
  // These two descriptions are fixed English strings written straight to the
  // ledger row (see `wallet.service.ts` `chargeAiUsage`/`spend`) — never
  // translated at write time, so show the already-localized category label
  // instead of the raw value here.
  if (txn.provider === 'ai-usage') {
    return t(CATEGORY_META.aiUsage.labelKey)
  }
  if (txn.description === BUILDER_UNLOCK_DESCRIPTION) {
    return t(CATEGORY_META.builderUnlock.labelKey)
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

      <!-- Campaign spend — clicks and whatever else the campaign itself
           consumes. CampaignSpendView links back here instead of repeating it. -->
      <section class="cons__section">
        <div class="cons__sectionHead">
          <h2 class="cons__sectionTitle">{{ t('consumption.campaignTitle') }}</h2>
          <router-link
            v-if="companyId"
            :to="{ name: 'campaign', query: { c: companyId } }"
            class="cons__sectionAction"
          >
            {{ t('consumption.viewCampaign') }} <v-icon icon="mdi-arrow-right" size="13" />
          </router-link>
        </div>
        <button
          type="button"
          class="cons__card cons__card--btn cons__card--hero"
          :class="{ 'is-active': filterCategory === 'clicks' }"
          @click="filterByCategory('clicks')"
        >
          <span class="cons__cardIcon"><v-icon :icon="CATEGORY_META.clicks.icon" size="20" /></span>
          <span class="cons__cardHeroBody">
            <span class="cons__cardLabel">{{ t(CATEGORY_META.clicks.labelKey) }}</span>
            <span class="cons__cardCount">
              {{
                campaignCategory?.count
                  ? t('consumption.txnCount', { n: campaignCategory.count })
                  : t('consumption.none')
              }}
            </span>
          </span>
          <strong class="cons__cardValue">{{ cr(campaignCategory?.total.credits ?? 0) }}</strong>
        </button>
        <div v-if="hasCampaignHistory" class="card cons__chart">
          <TrendChart :labels="campaignChart.labels" :series="campaignChart.series" />
        </div>
      </section>

      <!-- Everything else: Website Builder AI usage, its unlock fee, other. -->
      <section class="cons__section">
        <div class="cons__sectionHead">
          <h2 class="cons__sectionTitle">{{ t('consumption.otherTitle') }}</h2>
        </div>
        <div class="cons__grid">
          <button
            v-for="c in otherCategories"
            :key="c.key"
            type="button"
            class="cons__card cons__card--btn"
            :class="{ 'is-active': filterCategory === c.key }"
            @click="filterByCategory(c.key)"
          >
            <span class="cons__cardIcon"><v-icon :icon="CATEGORY_META[c.key].icon" size="18" /></span>
            <span class="cons__cardLabel">{{ t(CATEGORY_META[c.key].labelKey) }}</span>
            <strong class="cons__cardValue">{{ cr(c.total.credits) }}</strong>
            <span class="cons__cardCount">
              {{ c.count ? t('consumption.txnCount', { n: c.count }) : t('consumption.none') }}
            </span>
          </button>
        </div>
      </section>

      <!-- Filterable transaction list — every spend type, narrowed by
           category and/or date range. -->
      <section class="card cons__list">
        <div class="cons__listHead">
          <h3>{{ t('consumption.recentTitle') }}</h3>
        </div>

        <div class="cons__filters">
          <v-text-field
            v-model="filterSearch"
            :label="t('transactions.filterId')"
            :placeholder="t('transactions.filterIdPlaceholder')"
            prepend-inner-icon="mdi-magnify"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            class="cons__filterId"
          />
          <v-select
            v-model="filterCategory"
            :items="CATEGORY_FILTER_ITEMS"
            :label="t('consumption.filterType')"
            density="compact"
            variant="outlined"
            hide-details
            class="cons__filterType"
            @update:model-value="applyFilters"
          />
          <label class="cons__filterDate">
            <span>{{ t('consumption.filterFrom') }}</span>
            <input v-model="filterFrom" type="date" @change="applyFilters" />
          </label>
          <label class="cons__filterDate">
            <span>{{ t('consumption.filterTo') }}</span>
            <input v-model="filterTo" type="date" @change="applyFilters" />
          </label>
          <button
            v-if="hasActiveFilters"
            type="button"
            class="cons__filterClear"
            @click="clearFilters"
          >
            <v-icon icon="mdi-close" size="14" /> {{ t('consumption.filterClear') }}
          </button>
        </div>

        <div v-if="txnLoading && !transactions.length" class="cons__center cons__center--sm">
          <v-progress-circular indeterminate color="primary" size="22" />
        </div>
        <p v-else-if="!transactions.length" class="cons__empty">
          {{ hasActiveFilters ? t('consumption.emptyFiltered') : t('consumption.empty') }}
        </p>
        <ul v-else class="cons__rows">
          <li v-for="txn in transactions" :key="txn.id" class="crow">
            <div class="crow__main">
              <p class="crow__label">
                <span class="crow__id">{{ shortId(txn.id) }}</span> {{ txnLabel(txn) }}
              </p>
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
  max-width: 760px;
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
.cons__center--sm {
  min-height: 80px;
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
  margin-bottom: 1.5rem;
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

.cons__section {
  margin-bottom: 1.5rem;
}
.cons__sectionHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
  margin-bottom: 0.65rem;
}
.cons__sectionTitle {
  margin: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.cons__sectionAction {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex: none;
  font-size: 0.78rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
}
.cons__sectionAction:hover {
  text-decoration: underline;
}
.cons__card--hero {
  width: 100%;
  flex-direction: row;
  align-items: center;
  gap: 0.8rem;
  margin-bottom: 0.7rem;
}
.cons__card--hero .cons__cardIcon {
  margin-bottom: 0;
}
.cons__cardHeroBody {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.cons__card--hero .cons__cardValue {
  flex: none;
  font-size: 1.3rem;
}
.cons__chart {
  padding: 1rem 1.1rem 0.5rem;
}

.cons__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.7rem;
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
.cons__card--btn {
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease),
    background var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease);
}
.cons__card--btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.cons__card--btn.is-active {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.06);
}
.cons__cardIcon {
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-bottom: 0.2rem;
}
.cons__card--btn.is-active .cons__cardIcon {
  color: rgb(var(--v-theme-primary));
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

.cons__listHead {
  margin-bottom: 0.2rem;
}
.cons__listHead h3 {
  margin: 0;
}
.cons__filters {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 0.6rem;
  margin: 0.9rem 0 1.1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.cons__filterId {
  max-width: 12rem;
}
.cons__filterType {
  max-width: 12rem;
}
.cons__filterDate {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.cons__filterDate input[type='date'] {
  padding: 0.4rem 0.55rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.82rem;
}
.cons__filterClear {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.4rem 0.6rem;
  border-radius: 8px;
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.cons__filterClear:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
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
.crow__id {
  font-variant-numeric: tabular-nums;
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-right: 0.3rem;
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

@media (max-width: 620px) {
  .cons__grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
