<script setup lang="ts">
/**
 * Detailed lifetime spend for ONE business — the central place to see where
 * the budget went. Two small centered stat cards (clicks, total consumed),
 * the campaign spend trend, and a single filterable, paginated ledger
 * combining every billed click (its own județ + subcategorie + cost) and
 * every other spend category (Website Builder AI usage, its one-time unlock
 * fee, anything not yet categorized). The dashboard's own "Business spend"
 * card shows the same grand total (see `/wallet/spend-breakdown`); this page
 * is its detail view.
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
import { useWalletStore, type SpendCategory, type ConsumptionEntry } from '@/stores/wallet'

const { t, n, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const campaign = useCampaignStore()
const { spend: campaignSpend } = storeToRefs(campaign)
const walletStore = useWalletStore()
const { consumption, consumptionNextCursor, loading: txnLoading } = storeToRefs(walletStore)
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

const categoryByKey = computed(() => {
  const map = new Map<SpendCategory, CategoryRow>()
  for (const c of breakdown.value?.categories ?? []) map.set(c.key, c)
  return map
})
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

/** Real lifetime billed-click count — unlike a category's `count` (the
 *  number of underlying ledger rows), this is the actual number of clicks. */
const totalClicks = computed(() => campaignSpend.value?.lifetime.clicks ?? 0)

function catName(entry: { categoryName: { ro: string; en: string; de: string } | null }): string {
  return entry.categoryName?.[locale.value as 'ro' | 'en' | 'de'] ?? entry.categoryName?.en ?? ''
}
function countyLabel(county: string | null): string {
  if (!county) return ''
  return county === 'nationwide' ? t('feed.coverageCountry') : county
}

function cr(v: number): string {
  return n(v, { maximumFractionDigits: 2 })
}

// --- filters: which category + which date range the ledger shows ---
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
  await walletStore.loadConsumption(false, {
    companyId: companyId.value,
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
      walletStore.loadConsumption(false, { companyId: id }),
    ])
    breakdown.value = b
  } catch {
    error.value = t('consumption.loadError')
  } finally {
    loading.value = false
  }
}

async function loadMore(): Promise<void> {
  if (!consumptionNextCursor.value) return
  await walletStore.loadConsumption(true)
}

function entryLabel(e: ConsumptionEntry): string {
  if (e.kind === 'click') {
    return `${countyLabel(e.county)} · ${catName(e)}`
  }
  // These descriptions are fixed English strings written straight to the
  // ledger row (see `wallet.service.ts` `chargeClickWithin`/`chargeAiUsage`/
  // `spend`) — never translated at write time, so show the
  // already-localized category label instead of the raw value here.
  // The "clicks" category here is the day's rolled-up CPC row (shown
  // outside the dedicated "Click-uri anunț" filter, where individual
  // per-click Feed rows are used instead — see `kind === 'click'` above).
  if (e.category === 'clicks') return t('consumption.clicksRollup', { n: e.clicks ?? 0 })
  if (e.category === 'aiUsage') return t(CATEGORY_META.aiUsage.labelKey)
  if (e.category === 'builderUnlock') return t(CATEGORY_META.builderUnlock.labelKey)
  return e.description ?? t('consumption.txnOther')
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
      <!-- Two compact, centered stat cards — not full-width hero banners. -->
      <div class="cons__stats">
        <button
          type="button"
          class="statCard statCard--btn"
          :class="{ 'is-active': filterCategory === 'clicks' }"
          @click="filterByCategory('clicks')"
        >
          <span class="statCard__icon"><v-icon icon="mdi-cursor-default-click-outline" size="22" /></span>
          <strong class="statCard__value">{{ n(totalClicks, { maximumFractionDigits: 0 }) }}</strong>
          <span class="statCard__label">{{ t('consumption.clicks') }}</span>
        </button>
        <div class="statCard">
          <span class="statCard__icon"><v-icon icon="mdi-wallet-outline" size="22" /></span>
          <strong class="statCard__value">
            {{ cr(breakdown.total.credits) }}
            <v-icon icon="mdi-poker-chip" size="0.55em" class="cons__unit" />
          </strong>
          <span class="statCard__label">{{ t('consumption.totalLabel') }}</span>
          <span class="statCard__sub">{{ money.approx(breakdown.total.credits) }}</span>
        </div>
      </div>

      <!-- Campaign spend trend — clicks and whatever else the campaign itself
           consumes. CampaignSpendView links back here instead of repeating it. -->
      <section v-if="hasCampaignHistory" class="cons__section">
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
        <div class="card cons__chart">
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
            <strong class="cons__cardValue">
              {{ cr(c.total.credits) }}
              <v-icon icon="mdi-poker-chip" size="0.6em" class="cons__unit" />
            </strong>
            <span class="cons__cardCount">
              {{ c.count ? t('consumption.txnCount', { n: c.count }) : t('consumption.none') }}
            </span>
          </button>
        </div>
      </section>

      <!-- One unified, filterable, paginated ledger — every billed click
           (its own județ + subcategorie + cost) and every other spend
           category, merged and sorted together. -->
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

        <div v-if="txnLoading && !consumption.length" class="cons__center cons__center--sm">
          <v-progress-circular indeterminate color="primary" size="22" />
        </div>
        <p v-else-if="!consumption.length" class="cons__empty">
          {{ hasActiveFilters ? t('consumption.emptyFiltered') : t('consumption.empty') }}
        </p>
        <div v-else class="cons__ledgerWrap">
          <table class="cons__ledgerTable">
            <thead>
              <tr>
                <th>{{ t('consumption.colDate') }}</th>
                <th>{{ t('consumption.colDetail') }}</th>
                <th>{{ t('consumption.colClicks') }}</th>
                <th>{{ t('consumption.colAmount') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in consumption" :key="e.id">
                <td class="cons__ledgerDate">{{ new Date(e.createdAt).toLocaleString() }}</td>
                <td>
                  <span class="crow__id">{{ shortId(e.id) }}</span> {{ entryLabel(e) }}
                </td>
                <td>{{ e.clicks ?? '—' }}</td>
                <td class="cons__ledgerAmount">
                  {{ cr(Math.abs(e.amount.credits)) }}
                  <v-icon icon="mdi-poker-chip" size="0.6em" class="cons__unit" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <button
          v-if="consumptionNextCursor"
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

.cons__stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.8rem;
  margin-bottom: 1.5rem;
}
.statCard {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.2rem;
  padding: 1.1rem 1rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
}
.statCard--btn {
  cursor: pointer;
  transition: border-color var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease);
}
.statCard--btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.statCard--btn.is-active {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.06);
}
.statCard__icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  margin-bottom: 0.2rem;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
}
.statCard__value {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.6rem;
  font-weight: 700;
  color: rgb(var(--v-theme-primary));
}
.statCard__label {
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.statCard__sub {
  font-size: 0.76rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
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
.cons__unit {
  margin-left: 0.2em;
  opacity: 0.7;
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
.cons__ledgerWrap {
  overflow-x: auto;
}
.cons__ledgerTable {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
  white-space: nowrap;
}
.cons__ledgerTable th {
  text-align: left;
  padding: 0 0.6rem 0.5rem 0;
  font-size: 0.64rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-weight: 600;
}
.cons__ledgerTable td {
  padding: 0.6rem 0.6rem 0.6rem 0;
  border-top: 1px solid var(--tvz-hairline);
}
.cons__ledgerTable th:nth-child(3),
.cons__ledgerTable th:nth-child(4),
.cons__ledgerTable td:nth-child(3),
.cons__ledgerAmount {
  text-align: right;
}
.cons__ledgerDate {
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.78rem;
}
.crow__id {
  font-variant-numeric: tabular-nums;
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-right: 0.3rem;
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
@media (max-width: 420px) {
  .cons__stats {
    grid-template-columns: 1fr;
  }
}
</style>
