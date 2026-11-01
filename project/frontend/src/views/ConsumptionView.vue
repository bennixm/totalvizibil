<script setup lang="ts">
/**
 * Detailed lifetime spend for ONE business — the central place to see exactly
 * where the budget went: a KPI summary, 14-day evolution (clicks + spend,
 * each on its own scale), a full breakdown by search (județ + subcategorie —
 * the atomic Feed a click was billed against, see `campaign.service.ts`
 * `spendByFeedFor`), a click-quality panel (billed vs filtered, and why —
 * nothing here ever charged the owner), everything else the business spent
 * (Website Builder AI usage, its one-time unlock fee), and a unified,
 * filterable, paginated ledger. Modelled on a Google Ads-style campaign
 * report: one page that answers "where did the money go and why."
 *
 * All of this rides the SAME `campaign.loadSpend()` payload the Campaign hub
 * (`CampaignSpendView.vue`) already fetches — `byFeed`/`feedRanks`/
 * `clickQuality`/`runway`/`insights` were already computed server-side but,
 * before this redesign, never rendered anywhere. No backend change needed.
 *
 * Explicitly NOT here: spend-to-lead attribution ("this county produced N
 * leads"). `AdClick.visitorHash` and `Lead.visitorHash` use different hash
 * schemes with no foreign key between them — not derivable without a schema
 * change, so it isn't implied by anything on this page.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import TrendChart from '@/components/TrendChart.vue'
import { apiFetch } from '@/services/api'
import { useMoney } from '@/composables/useMoney'
import { useCompaniesStore } from '@/stores/companies'
import { useCampaignStore, type FeedRankEntry, type FeedSpendEntry } from '@/stores/campaign'
import { useWalletStore, type SpendCategory, type ConsumptionEntry } from '@/stores/wallet'

const { t, n, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const campaign = useCampaignStore()
const { spend: report } = storeToRefs(campaign)
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

// --- Campaign report (hasCampaign may be false — a business can have spent
// only on AI usage / the builder unlock and never run a campaign at all). ---
const hasCampaign = computed(() => !!report.value?.hasCampaign)

// --- KPI row ---------------------------------------------------------------
const kpis = computed(() => {
  const r = report.value
  if (!r) return null
  const runwayDays = r.runway.daysAtRecentPace ?? r.runway.daysAtBudget
  return {
    total: breakdown.value?.total.credits ?? 0,
    clicksLifetime: r.lifetime.clicks,
    clicksToday: r.today.clicks,
    cpcEffective: r.lifetime.cpcEffective,
    runwayDays,
  }
})

// --- Evolution: clicks and spend, each on its own scale (never a shared/
// dual axis — see the dataviz skill's one-axis rule). A "capped" day (the
// daily budget ran out and stopped the campaign early) is called out below
// the spend chart instead of as an in-chart marker, so TrendChart itself
// stays a plain, reusable component. ---
const chartClicks = computed(() => {
  const pts = report.value?.series ?? []
  return {
    labels: pts.map((p) => p.date.slice(5)),
    series: [{ label: t('spend.legendClicks'), values: pts.map((p) => p.clicks) }],
  }
})
const chartSpend = computed(() => {
  const pts = report.value?.series ?? []
  return {
    labels: pts.map((p) => p.date.slice(5)),
    series: [{ label: t('spend.legendSpent'), values: pts.map((p) => p.spent) }],
  }
})
function fmtCr(v: number): string {
  return n(v, { maximumFractionDigits: 2 }) + ' cr'
}
const cappedDaysCount = computed(() => (report.value?.series ?? []).filter((p) => p.capped).length)

// --- Consum pe căutare: every atomic Feed (județ + subcategorie) that ever
// billed a click, joined against the company's CURRENT position in it (a
// Feed can have spend history from before a category/location was edited,
// in which case there's simply no current position to show). Already
// sorted by spend server-side; `maxSpendMinor` drives the in-row share bar. ---
const feedRankByKey = computed(() => {
  const map = new Map<string, FeedRankEntry>()
  for (const r of report.value?.feedRanks ?? []) map.set(`${r.county}|${r.categorySlug}`, r)
  return map
})
interface FeedRow extends FeedSpendEntry {
  rank: FeedRankEntry | null
  sharePct: number
}
const byFeedRows = computed<FeedRow[]>(() => {
  const rows = report.value?.byFeed ?? []
  const maxMinor = Math.max(1, ...rows.map((r) => r.spent.minor))
  return rows.map((r) => ({
    ...r,
    rank: feedRankByKey.value.get(`${r.county}|${r.categorySlug}`) ?? null,
    sharePct: Math.round((r.spent.minor / maxMinor) * 100),
  }))
})

// --- Calitatea click-urilor: billed vs filtered, and why — nothing here
// ever charged the owner. Reason codes come straight from `ad_clicks.reason`
// (see `campaign.service.ts` `spendReportFor`'s 30-day roll-up). ---
const REASON_META: Record<string, { labelKey: string; tone: 'warning' | 'muted' | 'danger' }> = {
  budget: { labelKey: 'consumption.reason.budget', tone: 'warning' },
  off: { labelKey: 'consumption.reason.off', tone: 'muted' },
  bot: { labelKey: 'consumption.reason.bot', tone: 'danger' },
  insufficient: { labelKey: 'consumption.reason.insufficient', tone: 'danger' },
}
const qualityRows = computed(() => {
  const total = report.value?.clickQuality.unbilled ?? 0
  return (report.value?.clickQuality.byReason ?? []).map((r) => ({
    ...r,
    meta: REASON_META[r.reason] ?? { labelKey: 'consumption.reason.other', tone: 'muted' as const },
    pct: total > 0 ? Math.round((r.count / total) * 100) : 0,
  }))
})
const qualityTotal = computed(() => {
  const q = report.value?.clickQuality
  return q ? q.billed + q.unbilled : 0
})
const billedPct = computed(() => {
  const q = report.value?.clickQuality
  if (!q || qualityTotal.value === 0) return 100
  return Math.round((q.billed / qualityTotal.value) * 100)
})

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
      <p class="cons__lead">{{ t('consumption.lead') }}</p>
    </header>

    <div v-if="loading && !breakdown" class="cons__center">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <div v-else-if="error" class="cons__error">
      <v-icon icon="mdi-alert-circle-outline" size="16" /> {{ error }}
    </div>

    <template v-else-if="breakdown && kpis">
      <!-- Recommendations, if any — the same rule-based insights the
           campaign hub surfaces, repeated here since this is the page
           someone lands on specifically to understand *why* spend looks
           the way it does. -->
      <div v-if="hasCampaign && report && report.insights.length" class="cons__insights">
        <p v-for="ins in report.insights" :key="ins.key" class="cons__insight">
          <v-icon icon="mdi-lightbulb-on-outline" size="15" />
          {{ t('spend.insight.' + ins.key, { n: ins.value }) }}
        </p>
      </div>

      <!-- KPI summary row -->
      <div class="kpis">
        <div class="kpi kpi--hero">
          <span class="kpi__icon"><v-icon icon="mdi-wallet-outline" size="20" /></span>
          <strong class="kpi__value">
            {{ cr(kpis.total) }}<v-icon icon="mdi-poker-chip" size="0.55em" class="cons__unit" />
          </strong>
          <span class="kpi__label">{{ t('consumption.totalLabel') }}</span>
          <span class="kpi__sub">{{ money.approx(kpis.total) }}</span>
        </div>
        <button
          type="button"
          class="kpi kpi--btn"
          :class="{ 'is-active': filterCategory === 'clicks' }"
          @click="filterByCategory('clicks')"
        >
          <span class="kpi__icon"><v-icon icon="mdi-cursor-default-click-outline" size="20" /></span>
          <strong class="kpi__value">{{ n(kpis.clicksLifetime, { maximumFractionDigits: 0 }) }}</strong>
          <span class="kpi__label">{{ t('consumption.clicks') }}</span>
          <span v-if="hasCampaign" class="kpi__sub">{{ t('consumption.clicksTodaySub', { n: kpis.clicksToday }) }}</span>
        </button>
        <div v-if="hasCampaign" class="kpi">
          <span class="kpi__icon"><v-icon icon="mdi-currency-usd" size="20" /></span>
          <strong class="kpi__value">
            {{ kpis.cpcEffective ? cr(kpis.cpcEffective.credits) : '—' }}
            <v-icon v-if="kpis.cpcEffective" icon="mdi-poker-chip" size="0.55em" class="cons__unit" />
          </strong>
          <span class="kpi__label">{{ t('consumption.heroCpc') }}</span>
          <span class="kpi__sub">{{ t('consumption.heroCpcSub') }}</span>
        </div>
        <div v-if="hasCampaign" class="kpi" :class="{ 'kpi--warn': kpis.runwayDays != null && kpis.runwayDays < 5 }">
          <span class="kpi__icon"><v-icon icon="mdi-timer-sand" size="20" /></span>
          <strong class="kpi__value">
            {{ kpis.runwayDays != null ? n(kpis.runwayDays, { maximumFractionDigits: 1 }) : '—' }}
          </strong>
          <span class="kpi__label">{{ t('consumption.heroRunway') }}</span>
          <span class="kpi__sub">{{ t('consumption.heroRunwaySub') }}</span>
        </div>
      </div>

      <!-- Evolution: clicks + spend, 14 days -->
      <section v-if="hasCampaign && report" class="cons__section">
        <div class="cons__sectionHead">
          <h2 class="cons__sectionTitle">{{ t('consumption.evolutionTitle') }}</h2>
          <router-link :to="{ name: 'campaign', query: { c: companyId } }" class="cons__sectionAction">
            {{ t('consumption.viewCampaign') }} <v-icon icon="mdi-arrow-right" size="13" />
          </router-link>
        </div>
        <div class="card cons__chart">
          <div class="cons__chartGroup">
            <p class="cons__chartLabel">{{ t('spend.legendClicks') }}</p>
            <TrendChart :labels="chartClicks.labels" :series="chartClicks.series" />
          </div>
          <div class="cons__chartGroup">
            <p class="cons__chartLabel">{{ t('spend.legendSpent') }}</p>
            <TrendChart :labels="chartSpend.labels" :series="chartSpend.series" :format="fmtCr" />
          </div>
          <p v-if="cappedDaysCount > 0" class="cons__cappedNote">
            <v-icon icon="mdi-alert-outline" size="14" />
            {{ t('consumption.cappedNote', { n: cappedDaysCount }) }}
          </p>
        </div>
      </section>

      <!-- Consum pe căutare: every Feed (județ + subcategorie) a click was
           ever billed against, with current position where still eligible. -->
      <section v-if="hasCampaign && byFeedRows.length" class="cons__section">
        <div class="cons__sectionHead">
          <h2 class="cons__sectionTitle">{{ t('consumption.byFeedTitle') }}</h2>
        </div>
        <p class="cons__sectionHint">{{ t('consumption.byFeedHint') }}</p>
        <div class="card cons__feedWrap">
          <table class="cons__feedTable">
            <thead>
              <tr>
                <th>{{ t('consumption.colFeed') }}</th>
                <th>{{ t('consumption.colPosition') }}</th>
                <th>{{ t('consumption.colClicks') }}</th>
                <th>{{ t('consumption.colCpc') }}</th>
                <th>{{ t('consumption.colSpentFeed') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in byFeedRows" :key="r.county + r.categorySlug + i">
                <td class="cons__feedName" :data-label="t('consumption.colFeed')">
                  <v-icon icon="mdi-map-marker-outline" size="13" class="cons__feedPin" />
                  {{ countyLabel(r.county) }} · {{ catName(r) }}
                </td>
                <td class="cons__feedPos" :data-label="t('consumption.colPosition')">
                  <span v-if="r.rank" class="posChip" :class="{ 'is-top': r.rank.position === 1 }">
                    #{{ r.rank.position }}<span class="posChip__of">/{{ r.rank.total }}</span>
                  </span>
                  <span v-else class="cons__dim">{{ t('consumption.colPositionNone') }}</span>
                </td>
                <td :data-label="t('consumption.colClicks')">{{ r.clicks }}</td>
                <td :data-label="t('consumption.colCpc')">
                  {{ r.cpcEffective ? cr(r.cpcEffective.credits) : '—' }}
                </td>
                <td class="cons__feedSpent" :data-label="t('consumption.colSpentFeed')">
                  <span class="cons__feedBar"><span class="cons__feedBarFill" :style="{ width: r.sharePct + '%' }" /></span>
                  {{ cr(r.spent.credits) }}
                  <v-icon icon="mdi-poker-chip" size="0.6em" class="cons__unit" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Calitatea click-urilor — transparency on what DIDN'T cost anything. -->
      <section v-if="hasCampaign && report && qualityTotal > 0" class="cons__section">
        <div class="cons__sectionHead">
          <h2 class="cons__sectionTitle">{{ t('consumption.qualityTitle') }}</h2>
        </div>
        <p class="cons__sectionHint">{{ t('consumption.qualityHint') }}</p>
        <div class="card cons__quality">
          <div class="qbar">
            <span class="qbar__fill" :style="{ width: billedPct + '%' }" />
          </div>
          <div class="qsum">
            <span class="qsum__item qsum__item--billed">
              <i /> {{ t('consumption.qualityBilled') }}: <b>{{ report?.clickQuality.billed }}</b>
            </span>
            <span class="qsum__item">
              <i /> {{ t('consumption.qualityUnbilled') }}: <b>{{ report?.clickQuality.unbilled }}</b>
            </span>
          </div>
          <ul v-if="qualityRows.length" class="qlist">
            <li v-for="row in qualityRows" :key="row.reason" class="qlist__row">
              <span class="qlist__dot" :class="`qlist__dot--${row.meta.tone}`" />
              <span class="qlist__label">{{ t(row.meta.labelKey) }}</span>
              <span class="qlist__count">{{ row.count }}</span>
              <span class="qlist__pct">{{ row.pct }}%</span>
            </li>
          </ul>
        </div>
      </section>

      <!-- Everything else: Website Builder AI usage, its unlock fee, other. -->
      <section v-if="otherCategories.some((c) => c.count > 0) || !hasCampaign" class="cons__section">
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
          <v-btn
            v-if="consumption.length"
            :href="walletStore.consumptionExportUrl()"
            variant="text"
            size="small"
            prepend-icon="mdi-file-pdf-box"
          >
            {{ t('consumption.exportPdf') }}
          </v-btn>
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
                <td class="cons__ledgerDetail">
                  <span class="crow__id">{{ shortId(e.id) }}</span> {{ entryLabel(e) }}
                </td>
                <td class="cons__ledgerClicks" :data-label="t('consumption.colClicks')">{{ e.clicks ?? '—' }}</td>
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
  max-width: 860px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.cons__head {
  margin-bottom: 1.5rem;
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
.cons__lead {
  margin: 0.5rem 0 0;
  font-size: 0.88rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
  max-width: 54ch;
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

/* Recommendations ------------------------------------------------------ */
.cons__insights {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}
.cons__insight {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin: 0;
  padding: 0.7rem 0.9rem;
  border-radius: var(--tvz-radius-md);
  background: var(--tvz-ai-soft);
  border: 1px solid var(--tvz-glass-border);
  font-size: 0.84rem;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.cons__insight .v-icon {
  color: rgb(var(--v-theme-primary));
  margin-top: 0.1rem;
  flex: none;
}

/* KPI row ---------------------------------------------------------------- */
.kpis {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 1.05rem 1rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
}
.kpi--hero {
  background: linear-gradient(165deg, rgba(var(--v-theme-primary), 0.08), rgba(var(--v-theme-primary), 0.01));
  border-color: rgba(var(--v-theme-primary), 0.25);
}
.kpi--btn {
  cursor: pointer;
  text-align: left;
  transition: border-color var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease);
}
.kpi--btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.kpi--btn.is-active {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.06);
}
.kpi--warn {
  border-color: rgba(var(--v-theme-warning), 0.4);
  background: rgba(var(--v-theme-warning), 0.05);
}
.kpi__icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  margin-bottom: 0.3rem;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
}
.kpi--warn .kpi__icon {
  color: rgb(var(--v-theme-warning));
  background: rgba(var(--v-theme-warning), 0.14);
}
.kpi__value {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.45rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.kpi__label {
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.kpi__sub {
  font-size: 0.74rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.cons__unit {
  margin-left: 0.2em;
  opacity: 0.7;
}

.cons__section {
  margin-bottom: 1.5rem;
}
.cons__sectionHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
  margin-bottom: 0.3rem;
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
.cons__sectionHint {
  margin: 0 0 0.65rem;
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
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

/* Evolution charts -------------------------------------------------------- */
.cons__chart {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  padding: 1.1rem 1.1rem 0.6rem;
}
.cons__chartGroup {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.cons__chartLabel {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.cons__cappedNote {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
  padding-top: 0.6rem;
  border-top: 1px solid var(--tvz-hairline);
  font-size: 0.78rem;
  color: rgb(var(--v-theme-warning));
}

/* Consum pe căutare (by Feed) ---------------------------------------------- */
.cons__feedWrap {
  padding: 0.3rem 1rem 0.3rem;
  overflow-x: auto;
}
.cons__feedTable {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
}
.cons__feedTable th {
  text-align: left;
  padding: 0.7rem 0.6rem 0.6rem 0;
  font-size: 0.64rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-weight: 600;
  white-space: nowrap;
}
.cons__feedTable td {
  padding: 0.7rem 0.6rem 0.7rem 0;
  border-top: 1px solid var(--tvz-hairline);
  white-space: nowrap;
}
.cons__feedName {
  font-weight: 600;
  white-space: normal;
}
.cons__feedPin {
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-right: 0.1rem;
}
.posChip {
  display: inline-flex;
  align-items: baseline;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  background: rgba(var(--v-theme-warning), 0.12);
  color: rgb(var(--v-theme-warning));
}
.posChip.is-top {
  background: rgba(var(--v-theme-success), 0.12);
  color: rgb(var(--v-theme-success));
}
.posChip__of {
  font-weight: 400;
  opacity: 0.7;
  margin-left: 0.05rem;
}
.cons__dim {
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.cons__feedSpent {
  position: relative;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.cons__feedBar {
  display: block;
  width: 56px;
  height: 4px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  overflow: hidden;
  margin-bottom: 0.3rem;
}
.cons__feedBarFill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: rgb(var(--v-theme-primary));
}

/* Calitatea click-urilor ---------------------------------------------------- */
.cons__quality {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.qbar {
  display: flex;
  width: 100%;
  height: 10px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(var(--v-theme-error), 0.18);
}
.qbar__fill {
  display: block;
  height: 100%;
  background: rgb(var(--v-theme-success));
  border-radius: 999px 0 0 999px;
}
.qsum {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.qsum__item {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.qsum__item i {
  width: 9px;
  height: 9px;
  border-radius: 3px;
  background: rgba(var(--v-theme-error), 0.5);
}
.qsum__item--billed i {
  background: rgb(var(--v-theme-success));
}
.qsum__item b {
  font-variant-numeric: tabular-nums;
  color: rgb(var(--v-theme-on-surface));
}
.qlist {
  list-style: none;
  margin: 0;
  padding: 0.7rem 0 0;
  border-top: 1px solid var(--tvz-hairline);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.qlist__row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-size: 0.82rem;
}
.qlist__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.qlist__dot--warning {
  background: rgb(var(--v-theme-warning));
}
.qlist__dot--danger {
  background: rgb(var(--v-theme-error));
}
.qlist__dot--muted {
  background: rgba(var(--v-theme-on-surface), 0.35);
}
.qlist__label {
  flex: 1;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.qlist__count {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.qlist__pct {
  width: 3.2em;
  text-align: right;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-variant-numeric: tabular-nums;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
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
.cons__ledgerClicks,
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

/* Mobile: KPI row stays 2-up, by-Feed table becomes cards, filters stack,
   ledger stops scrolling sideways. */
@media (max-width: 760px) {
  .kpis {
    grid-template-columns: 1fr 1fr;
  }
  .cons__grid {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 640px) {
  .cons__filters {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
  }
  .cons__filterId,
  .cons__filterType {
    max-width: none;
    width: 100%;
  }
  .cons__filterDate {
    width: 100%;
  }
  .cons__filterDate input[type='date'] {
    width: 100%;
  }
  .cons__filterClear {
    justify-content: center;
    padding: 0.7rem 0.6rem;
  }

  .cons__feedWrap {
    overflow-x: visible;
    padding: 0.3rem 0.1rem;
  }
  .cons__feedTable thead {
    display: none;
  }
  .cons__feedTable,
  .cons__feedTable tbody,
  .cons__feedTable tr,
  .cons__feedTable td {
    display: block;
    width: 100%;
  }
  .cons__feedTable tr {
    padding: 0.8rem 0.9rem;
    margin-bottom: 0.6rem;
    border: 1px solid var(--tvz-glass-border);
    border-radius: var(--tvz-radius-md);
  }
  .cons__feedTable tr:last-child {
    margin-bottom: 0;
  }
  .cons__feedTable td {
    padding: 0.2rem 0;
    border-top: none;
    white-space: normal;
  }
  .cons__feedTable td::before {
    content: attr(data-label) ': ';
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: rgba(var(--v-theme-on-surface), 0.45);
    margin-right: 0.3rem;
  }
  .cons__feedName::before {
    content: none;
  }

  .cons__ledgerWrap {
    overflow-x: visible;
  }
  .cons__ledgerTable {
    white-space: normal;
  }
  .cons__ledgerTable thead {
    display: none;
  }
  .cons__ledgerTable,
  .cons__ledgerTable tbody,
  .cons__ledgerTable tr,
  .cons__ledgerTable td {
    display: block;
    width: 100%;
  }
  .cons__ledgerTable tr {
    display: flex;
    flex-wrap: wrap;
    padding: 0.8rem 0.9rem;
    margin-bottom: 0.6rem;
    border: 1px solid var(--tvz-glass-border);
    border-radius: var(--tvz-radius-md);
    border-top: none;
  }
  .cons__ledgerTable tr:last-child {
    margin-bottom: 0;
  }
  .cons__ledgerTable td {
    padding: 0;
    border-top: none;
  }
  .cons__ledgerDate {
    order: 1;
    margin-bottom: 0.3rem;
  }
  .cons__ledgerDetail {
    order: 2;
    width: 100%;
    margin-bottom: 0.55rem;
    font-weight: 600;
    white-space: normal;
  }
  .cons__ledgerClicks {
    order: 3;
    flex: 1 1 auto;
    width: auto;
    text-align: left;
    font-size: 0.78rem;
    color: rgba(var(--v-theme-on-surface), 0.6);
  }
  .cons__ledgerClicks::before {
    content: attr(data-label) ': ';
  }
  .cons__ledgerAmount {
    order: 4;
    width: auto;
    font-weight: 700;
  }
}

@media (max-width: 420px) {
  .kpis {
    grid-template-columns: 1fr;
  }
  .cons__grid {
    grid-template-columns: 1fr;
  }
}
</style>
