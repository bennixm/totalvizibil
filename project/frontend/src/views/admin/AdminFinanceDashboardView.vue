<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminStatCard from '@/components/admin/AdminStatCard.vue'
import AdminSection from '@/components/admin/AdminSection.vue'
import AdminPager from '@/components/admin/AdminPager.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import AdminPeriodFilter from '@/components/admin/AdminPeriodFilter.vue'
import TrendChart from '@/components/TrendChart.vue'
import { useMoney } from '@/composables/useMoney'
import { usePeriodFilter } from '@/composables/usePeriodFilter'
import { useAdminFinanceStore, type ExpenseCategory } from '@/stores/adminFinance'

const { t } = useI18n()
const finance = useAdminFinanceStore()
const money = useMoney()

// 1 credit ≡ 1 EUR everywhere in the platform — `money.fiat()` already
// knows how to render in whichever currency the global EUR/RON toggle (top
// nav) is set to; every admin-finance figure is EUR minor units, so this is
// the only conversion needed to make that toggle actually affect this page.
function eur(minor: number): string {
  return money.fiat(minor / 100)
}
function pct(value: number): string {
  return `${value.toLocaleString('ro-RO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}
function dt(s: string): string {
  return new Date(s).toLocaleDateString('ro-RO')
}
function profitTone(minor: number): 'success' | 'error' {
  return minor >= 0 ? 'success' : 'error'
}

const CATEGORY_LABEL_KEYS: Record<ExpenseCategory, string> = {
  hosting: 'adminFinance.catHosting',
  call_center: 'adminFinance.catCallCenter',
  cloud_storage: 'adminFinance.catCloudStorage',
  domains: 'adminFinance.catDomains',
  google_ads: 'adminFinance.catGoogleAds',
  stripe_fees: 'adminFinance.catStripeFees',
  other: 'adminFinance.catOther',
}

const categoryRows = computed(() => {
  const o = finance.overview
  if (!o) return []
  return (Object.keys(CATEGORY_LABEL_KEYS) as ExpenseCategory[])
    .map((key) => ({ key, label: t(CATEGORY_LABEL_KEYS[key]), amountMinor: o.expensesByCategory[key] }))
    .concat([{ key: 'ai_api' as ExpenseCategory, label: t('adminFinance.aiCost'), amountMinor: o.aiCostMinor }])
    .filter((r) => r.amountMinor > 0)
    .sort((a, b) => b.amountMinor - a.amountMinor)
})

const ONE_OFF_LABEL_KEYS = {
  aiUsage: 'adminFinance.oneOffAiUsage',
  builderUnlock: 'adminFinance.oneOffBuilderUnlock',
  other: 'adminFinance.oneOffOther',
} as const

const oneOffRows = computed(() => {
  const o = finance.overview
  if (!o) return []
  return (Object.keys(ONE_OFF_LABEL_KEYS) as (keyof typeof ONE_OFF_LABEL_KEYS)[])
    .map((key) => ({ key, label: t(ONE_OFF_LABEL_KEYS[key]), amountMinor: o.otherFeesByCategory[key] }))
    .filter((r) => r.amountMinor > 0)
    .sort((a, b) => b.amountMinor - a.amountMinor)
})

// --- charts ----------------------------------------------------------------
// `trend[]` has always been computed server-side and never rendered; these
// feed it into the same TrendChart the rest of the panel uses.
const trendLabels = computed(() =>
  (finance.overview?.trend ?? []).map((p) => {
    const [, m, d] = p.date.split('-')
    return `${d}.${m}`
  }),
)
const moneySeries = computed(() => {
  const trend = finance.overview?.trend ?? []
  return [
    { label: t('adminFinance.revenue'), values: trend.map((p) => p.revenueMinor / 100) },
    { label: t('adminFinance.costs'), values: trend.map((p) => p.costMinor / 100) },
  ]
})
const refundRatioSeries = computed(() => [
  {
    label: t('adminFinance.refundRatioLabel'),
    values: (finance.overview?.trend ?? []).map((p) => p.refundRatioPct),
  },
])
const hasTrend = computed(() => (finance.overview?.trend.length ?? 0) > 0)
function eurAxis(value: number): string {
  return `${Math.round(value).toLocaleString('ro-RO')} €`
}
function pctAxis(value: number): string {
  return `${Math.round(value)}%`
}

// --- drill-down tables -----------------------------------------------------
const drillTab = ref<'voided' | 'companies'>('voided')
watch(
  drillTab,
  (tab) => {
    if (tab === 'voided' && !finance.voidedInvoicesLoaded) void finance.fetchVoidedInvoices()
    if (tab === 'companies' && !finance.topCompaniesLoaded) void finance.fetchTopCompanies()
  },
  { immediate: true },
)

// Drives the filter bar's highlighted preset — `v-btn-toggle` had no
// `value` on its children before, so nothing was ever shown as active no
// matter which range was actually applied.
const { activePreset, customFrom, customTo, canApplyCustom, setQuickRange, applyCustomRange } =
  usePeriodFilter((from, to, lifetime) => finance.setPeriod(from, to, lifetime))

// What's actually being shown right now, straight from the resolved
// server-side range — so switching a preset or a custom range always has a
// visible, unambiguous confirmation instead of the admin having to guess.
const activeRangeLabel = computed(() => {
  const r = finance.overview?.range
  if (!r) return ''
  if (!r.from && !r.to) return t('adminFinance.lifetime')
  return `${r.from ? dt(r.from) : '…'} – ${r.to ? dt(r.to) : '…'}`
})

// `setQuickRange` (not a bare `fetchOverview()`) so the "Luna aceasta" preset
// shown as active on first paint is also the range actually requested —
// otherwise the toggle claimed "this month" while the data underneath was
// whatever the backend's own unrelated default happened to be.
onMounted(() => setQuickRange('month'))
</script>

<template>
  <div class="afd">
    <AdminPageHeader :title="t('adminFinance.dashboardTitle')" :eyebrow="t('admin.navGroupFinance')">
    </AdminPageHeader>

    <AdminPeriodFilter
      v-model:custom-from="customFrom"
      v-model:custom-to="customTo"
      :preset="activePreset"
      :can-apply-custom="canApplyCustom"
      :active-range-label="activeRangeLabel"
      @preset="setQuickRange"
      @apply="applyCustomRange"
    />

    <div v-if="finance.loadingOverview && !finance.overview" class="afd__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <!-- The entire page is inside `v-else-if="finance.overview"`, so a failed
         `/admin/finance/overview` left a blank page behind the spinner. -->
    <AdminEmptyState
      v-else-if="finance.overviewError"
      icon="mdi-alert-circle-outline"
      :text="finance.overviewError"
    />

    <template v-else-if="finance.overview">
      <!-- The headline: real profit, always Today/This month/This year —
           independent of the period picker above (same reasoning as the
           point-in-time balance-sheet figures further down the page). -->
      <AdminSection :title="t('adminFinance.finalProfitTitle')" icon="mdi-piggy-bank-outline" class="afd__hero">
        <div class="afd__kpis afd__kpis--three">
          <AdminStatCard
            :label="t('adminFinance.today')"
            :value="eur(finance.overview.finalProfit.today.profitMinor)"
            icon="mdi-calendar-today-outline"
            :tone="profitTone(finance.overview.finalProfit.today.profitMinor)"
          />
          <AdminStatCard
            :label="t('adminFinance.thisMonth')"
            :value="eur(finance.overview.finalProfit.month.profitMinor)"
            icon="mdi-calendar-month-outline"
            :tone="profitTone(finance.overview.finalProfit.month.profitMinor)"
          />
          <AdminStatCard
            :label="t('adminFinance.thisYear')"
            :value="eur(finance.overview.finalProfit.year.profitMinor)"
            icon="mdi-calendar-blank-outline"
            :tone="profitTone(finance.overview.finalProfit.year.profitMinor)"
          />
        </div>
        <p class="afd__hint">{{ t('adminFinance.finalProfitHint') }}</p>
      </AdminSection>

      <!-- Bani încasați → costuri → profit, for the SELECTED period (the
           picker above) — the same formula as "Profit final" above, just
           over whichever range is currently chosen, so the two can never
           silently disagree. -->
      <div class="afd__kpis afd__kpis--four">
        <AdminStatCard
          :label="t('adminFinance.collectedRevenue')"
          :value="eur(finance.overview.revenueMinor)"
          :sub="`${eur(finance.overview.unconsumedRevenueMinor)} ${t('adminFinance.unconsumedRevenue').toLowerCase()}`"
          icon="mdi-cash-plus"
        />
        <AdminStatCard
          :label="t('adminFinance.consumedRevenue')"
          :value="eur(finance.overview.consumedRevenueRealMoneyMinor)"
          :sub="t('adminFinance.consumedRevenueHint')"
          icon="mdi-bank-transfer-in"
          tone="primary"
        />
        <AdminStatCard :label="t('adminFinance.costs')" :value="eur(finance.overview.totalCostMinor)" icon="mdi-cash-minus" tone="error" />
        <AdminStatCard
          :label="t('adminFinance.netProfit')"
          :value="eur(finance.overview.profitMinor)"
          icon="mdi-chart-line"
          :tone="profitTone(finance.overview.profitMinor)"
        />
      </div>
      <p class="afd__hint">{{ t('adminFinance.unconsumedRevenueHint') }}</p>

      <!-- Gross (credit face value sold) vs net (money collected); the delta
           is what the discount cost over this period. -->
      <div class="afd__kpis afd__kpis--three">
        <AdminStatCard
          :label="t('adminFinance.grossRevenue')"
          :value="eur(finance.overview.grossRevenueMinor)"
          :sub="t('adminFinance.grossRevenueSub')"
          icon="mdi-tag-outline"
        />
        <AdminStatCard
          :label="t('adminFinance.discountCost')"
          :value="eur(finance.overview.discountCostMinor)"
          :sub="t('adminFinance.discountCostSub', { pct: pct(finance.overview.grossToNetRatio * 100) })"
          icon="mdi-sale"
          :tone="finance.overview.discountCostMinor > 0 ? 'warning' : undefined"
        />
        <AdminStatCard
          :label="t('adminFinance.refundFeeIncome')"
          :value="eur(finance.overview.refundFeeIncomeMinor)"
          :sub="t('adminFinance.refundFeeIncomeSub')"
          icon="mdi-cash-refund"
          tone="success"
        />
      </div>

      <AdminSection :title="t('adminFinance.dailyTrendTitle')" icon="mdi-chart-line" class="afd__chart">
        <TrendChart
          v-if="hasTrend"
          :labels="trendLabels"
          :series="moneySeries"
          :format="eurAxis"
        />
        <p v-else class="afd__muted">{{ t('adminFinance.noTrendData') }}</p>
      </AdminSection>

      <AdminSection
        v-if="hasTrend"
        :title="t('adminFinance.refundRatioTitle')"
        icon="mdi-chart-bell-curve-cumulative"
        class="afd__chart"
      >
        <TrendChart :labels="trendLabels" :series="refundRatioSeries" :format="pctAxis" />
        <p class="afd__hint">{{ t('adminFinance.refundRatioHint') }}</p>
      </AdminSection>

      <div class="afd__grid">
        <AdminSection :title="t('adminFinance.costBreakdown')" icon="mdi-chart-donut" wide>
          <ul v-if="categoryRows.length" class="afd__catlist">
            <li v-for="row in categoryRows" :key="row.key" class="afd__catrow">
              <span class="afd__catlabel">{{ row.label }}</span>
              <span class="afd__catvalue">{{ eur(row.amountMinor) }}</span>
            </li>
          </ul>
          <p v-else class="afd__muted">{{ t('adminFinance.noCosts') }}</p>
        </AdminSection>

        <AdminSection :title="t('adminFinance.promotionProfitTitle')" icon="mdi-google-ads">
          <ul class="afd__catlist">
            <li class="afd__catrow">
              <span class="afd__catlabel">{{ t('adminFinance.cpcRevenueCredits') }}</span>
              <span class="afd__catvalue">{{ eur(finance.overview.paidTraffic.cpcRevenueMinor) }}</span>
            </li>
            <li class="afd__catrow">
              <span class="afd__catlabel">{{ t('adminFinance.cpcRevenueRealMoney') }}</span>
              <span class="afd__catvalue">{{ eur(finance.overview.paidTraffic.cpcRevenueRealMoneyMinor) }}</span>
            </li>
            <li class="afd__catrow">
              <span class="afd__catlabel">{{ t('adminFinance.adSpend') }}</span>
              <span class="afd__catvalue">{{ eur(finance.overview.paidTraffic.adSpendMinor) }}</span>
            </li>
            <li class="afd__catrow afd__catrow--total">
              <span class="afd__catlabel">{{ t('adminFinance.trafficProfitRealMoney') }}</span>
              <span class="afd__catvalue">{{ eur(finance.overview.paidTraffic.realMoneyProfitMinor) }}</span>
            </li>
          </ul>
          <p class="afd__hint">{{ t('adminFinance.paidTrafficHint') }}</p>
        </AdminSection>

        <!-- Profit/cost split for the website-builder AI: what customers'
             wallets actually paid for prompts + the unlock fee (real money)
             vs. what the platform paid Claude/DeepSeek for it. The campaign
             agent row is a placeholder — that feature doesn't exist yet. -->
        <AdminSection :title="t('adminFinance.aiBuilderTitle')" icon="mdi-robot-outline">
          <ul class="afd__catlist">
            <li class="afd__catrow">
              <span class="afd__catlabel">{{ t('adminFinance.aiBuilderPromptProfit') }}</span>
              <span class="afd__catvalue">{{ eur(finance.overview.aiBuilder.promptProfitMinor) }}</span>
            </li>
            <li class="afd__catrow">
              <span class="afd__catlabel">{{ t('adminFinance.aiBuilderUnlockProfit') }}</span>
              <span class="afd__catvalue">{{ eur(finance.overview.aiBuilder.builderUnlockRevenueRealMoneyMinor) }}</span>
            </li>
            <li class="afd__catrow afd__catrow--total">
              <span class="afd__catlabel">{{ t('adminFinance.aiBuilderProfit') }}</span>
              <span class="afd__catvalue">{{ eur(finance.overview.aiBuilder.totalProfitMinor) }}</span>
            </li>
            <li class="afd__catrow afd__catrow--sub">
              <span class="afd__catlabel">{{ t('adminFinance.aiBuilderCost') }}</span>
              <span class="afd__catvalue">{{ eur(finance.overview.aiBuilder.providerCostMinor) }}</span>
            </li>
            <li class="afd__catrow afd__catrow--sub">
              <span class="afd__catlabel">
                {{ t('adminFinance.campaignAgentCost') }}
                <v-chip size="x-small" variant="tonal" density="compact" class="afd__soon">{{ t('adminFinance.comingSoon') }}</v-chip>
              </span>
              <span class="afd__catvalue">{{ eur(finance.overview.aiBuilder.campaignAgentCostMinor) }}</span>
            </li>
          </ul>
          <p class="afd__hint">{{ t('adminFinance.campaignAgentHint') }}</p>
        </AdminSection>

        <!-- The CPC-vs-one-off split, labelled for what it is. -->
        <AdminSection :title="t('adminFinance.creditConsumptionTitle')" icon="mdi-repeat-variant">
          <ul class="afd__catlist">
            <li class="afd__catrow">
              <span class="afd__catlabel">{{ t('adminFinance.recurringCpc') }}</span>
              <span class="afd__catvalue">{{ eur(finance.overview.creditConsumption.recurringMinor) }}</span>
            </li>
            <li class="afd__catrow">
              <span class="afd__catlabel">{{ t('adminFinance.oneTimeFees') }}</span>
              <span class="afd__catvalue">{{ eur(finance.overview.creditConsumption.oneTimeMinor) }}</span>
            </li>
            <li v-for="row in oneOffRows" :key="row.key" class="afd__catrow afd__catrow--sub">
              <span class="afd__catlabel">{{ row.label }}</span>
              <span class="afd__catvalue">{{ eur(row.amountMinor) }}</span>
            </li>
            <li class="afd__catrow afd__catrow--total">
              <span class="afd__catlabel">{{ t('adminFinance.totalConsumed') }}</span>
              <span class="afd__catvalue">
                {{ eur(finance.overview.creditConsumption.recurringMinor + finance.overview.creditConsumption.oneTimeMinor) }}
              </span>
            </li>
          </ul>
          <p class="afd__hint">{{ t('adminFinance.creditConsumptionHint') }}</p>
        </AdminSection>

        <AdminSection :title="t('adminFinance.vatTitle')" icon="mdi-percent-outline" wide>
          <div v-if="finance.overview.vatBreakdown.length" class="afd__vat">
            <div class="afd__vathead" aria-hidden="true">
              <span>{{ t('adminFinance.vatColRate') }}</span>
              <span>{{ t('adminFinance.vatColInvoices') }}</span>
              <span>{{ t('adminFinance.vatColBase') }}</span>
              <span>{{ t('adminFinance.vatColVat') }}</span>
              <span>{{ t('adminFinance.vatColTotal') }}</span>
            </div>
            <div
              v-for="row in finance.overview.vatBreakdown"
              :key="`${row.vatRatePct}-${row.currency}`"
              class="afd__vatrow"
            >
              <span :data-label="t('adminFinance.vatColRate')">{{ row.vatRatePct }}% · {{ row.currency }}</span>
              <span :data-label="t('adminFinance.vatColInvoices')">{{ row.invoiceCount }}</span>
              <span :data-label="t('adminFinance.vatColBase')">{{ eur(row.subtotalMinor) }}</span>
              <span :data-label="t('adminFinance.vatColVat')">{{ eur(row.vatMinor) }}</span>
              <span :data-label="t('adminFinance.vatColTotal')"><b>{{ eur(row.totalMinor) }}</b></span>
            </div>
          </div>
          <p v-else class="afd__muted">{{ t('adminFinance.noInvoicesInPeriod') }}</p>
          <p class="afd__hint">{{ t('adminFinance.vatCurrencyHint') }}</p>
        </AdminSection>
      </div>

      <!-- Point-in-time balance-sheet figures: these ignore the period
           filter on purpose (a liability is what's owed right now).
           Reconciliation detail, not a headline figure — kept near the
           bottom, right before the drill-downs it's most related to. -->
      <div class="afd__kpis afd__kpis--four">
        <AdminStatCard
          :label="t('adminFinance.walletLiability')"
          :value="eur(finance.overview.walletLiabilityMinor)"
          :sub="t('adminFinance.walletLiabilitySub')"
          icon="mdi-wallet-outline"
          tone="warning"
        />
        <AdminStatCard
          :label="t('adminFinance.blockedBalance')"
          :value="eur(finance.overview.blockedWalletBalanceMinor)"
          :sub="t('adminFinance.blockedBalanceSub')"
          icon="mdi-lock-outline"
        />
        <AdminStatCard
          :label="t('adminFinance.refundInFlight')"
          :value="eur(finance.overview.refundLiabilityInFlightMinor)"
          :sub="t('adminFinance.refundInFlightSub')"
          icon="mdi-progress-clock"
        />
        <AdminStatCard
          :label="t('adminFinance.refundRate')"
          :value="pct(finance.overview.refundRatioPct)"
          :sub="t('adminFinance.refundRateSub', { amount: eur(finance.overview.refundsMoneyMinor) })"
          icon="mdi-undo-variant"
        />
      </div>

      <!-- Drill-downs on the same page: no new routes. -->
      <AdminSection class="afd__drill" wide>
        <v-tabs v-model="drillTab" density="compact" class="afd__tabs">
          <v-tab value="voided">{{ t('adminFinance.tabVoidedInvoices') }}</v-tab>
          <v-tab value="companies">{{ t('adminFinance.tabTopCompanies') }}</v-tab>
        </v-tabs>

        <v-window v-model="drillTab" class="afd__window">
          <v-window-item value="voided">
            <div class="afd__drillhead">
              <span>{{ t('adminFinance.voidedCountInPeriod', { n: finance.voidedInvoicesTotal }) }}</span>
              <b>{{ eur(finance.voidedInvoicesSumMinor) }}</b>
            </div>
            <div v-if="finance.loadingVoidedInvoices" class="afd__center">
              <v-progress-circular indeterminate color="primary" size="28" />
            </div>
            <AdminEmptyState
              v-else-if="finance.voidedInvoicesError"
              icon="mdi-alert-circle-outline"
              :text="finance.voidedInvoicesError"
            />
            <p v-else-if="!finance.voidedInvoices.length" class="afd__muted">
              {{ t('adminFinance.noVoidedInvoices') }}
            </p>
            <div v-else class="afd__rows">
              <div class="afd__rowhead afd__rowhead--voided" aria-hidden="true">
                <span>{{ t('adminFinance.colNumber') }}</span>
                <span>{{ t('adminFinance.colClient') }}</span>
                <span>{{ t('adminFinance.colVoidedAt') }}</span>
                <span>{{ t('adminFinance.colReason') }}</span>
                <span>{{ t('adminFinance.vatColTotal') }}</span>
              </div>
              <div
                v-for="inv in finance.voidedInvoices"
                :key="inv.id"
                class="afd__row afd__row--voided"
              >
                <span :data-label="t('adminFinance.colNumber')"><b>{{ inv.number }}</b></span>
                <span :data-label="t('adminFinance.colClient')">{{ inv.buyerName }}</span>
                <span :data-label="t('adminFinance.colVoidedAt')">{{ dt(inv.voidedAt) }}</span>
                <span :data-label="t('adminFinance.colReason')" class="afd__reason">{{ inv.voidReason ?? '—' }}</span>
                <span :data-label="t('adminFinance.vatColTotal')">
                  {{ (inv.totalMinor / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2 }) }}
                  {{ inv.currency }}
                </span>
              </div>
            </div>
            <AdminPager
              :page="finance.voidedInvoicesPage"
              :page-size="20"
              :total="finance.voidedInvoicesTotal"
              @update:page="finance.setVoidedInvoicesPage($event)"
            />
          </v-window-item>

          <v-window-item value="companies">
            <div class="afd__drillhead">
              <span>{{ t('adminFinance.companiesCountInPeriod', { n: finance.topCompaniesTotal }) }}</span>
              <b>{{ eur(finance.topCompaniesSpendMinor) }}</b>
            </div>
            <div v-if="finance.loadingTopCompanies" class="afd__center">
              <v-progress-circular indeterminate color="primary" size="28" />
            </div>
            <AdminEmptyState
              v-else-if="finance.topCompaniesError"
              icon="mdi-alert-circle-outline"
              :text="finance.topCompaniesError"
            />
            <p v-else-if="!finance.topCompanies.length" class="afd__muted">
              {{ t('adminFinance.noCompaniesCpcSpend') }}
            </p>
            <div v-else class="afd__rows">
              <div class="afd__rowhead afd__rowhead--company" aria-hidden="true">
                <span>{{ t('adminFinance.colBusiness') }}</span>
                <span>{{ t('adminFinance.colClicks') }}</span>
                <span>{{ t('adminFinance.colSpend') }}</span>
              </div>
              <div
                v-for="c in finance.topCompanies"
                :key="c.companyId"
                class="afd__row afd__row--company"
              >
                <span :data-label="t('adminFinance.colBusiness')"><b>{{ c.companyName ?? '—' }}</b></span>
                <span :data-label="t('adminFinance.colClicks')">{{ c.clicks.toLocaleString('ro-RO') }}</span>
                <span :data-label="t('adminFinance.colSpend')">{{ eur(c.spendMinor) }}</span>
              </div>
            </div>
            <AdminPager
              :page="finance.topCompaniesPage"
              :page-size="20"
              :total="finance.topCompaniesTotal"
              @update:page="finance.setTopCompaniesPage($event)"
            />
          </v-window-item>
        </v-window>
      </AdminSection>
    </template>
  </div>
</template>

<style scoped>
.afd {
  max-width: 1100px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.afd__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.afd__kpis {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.7rem;
  margin-bottom: 1.4rem;
}
.afd__kpis--four {
  grid-template-columns: repeat(4, 1fr);
}
.afd__kpis--three {
  grid-template-columns: repeat(3, 1fr);
}
.afd__chart {
  margin-bottom: 1rem;
}
/* The one section meant to read as the page's headline, not just another
   card group — a subtle accent border/tint, same glass surface otherwise. */
.afd__hero {
  margin-bottom: 1.4rem;
  border-color: rgba(var(--v-theme-primary), 0.35);
}
.afd__hero .afd__kpis {
  margin-bottom: 0;
}
.afd__soon {
  margin-left: 0.4rem;
  vertical-align: middle;
}
.afd__grid {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 1rem;
}
.afd__drill {
  margin-top: 1rem;
}
.afd__tabs {
  margin-bottom: 0.6rem;
}
.afd__drillhead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.6rem 0 0.9rem;
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.afd__drillhead b {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), 0.9);
}

/* Shared row grids for the VAT table and the two drill-down tables. */
.afd__vathead,
.afd__vatrow,
.afd__rowhead,
.afd__row {
  display: grid;
  align-items: center;
  gap: 0.8rem;
  font-size: 0.84rem;
}
.afd__vathead,
.afd__vatrow {
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 0.6fr) repeat(3, minmax(0, 1fr));
}
.afd__rowhead--voided,
.afd__row--voided {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 0.8fr) minmax(0, 1.4fr) minmax(0, 0.9fr);
}
.afd__rowhead--company,
.afd__row--company {
  grid-template-columns: minmax(0, 2fr) minmax(0, 0.7fr) minmax(0, 0.9fr);
}
.afd__vathead,
.afd__rowhead {
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.45);
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.afd__vatrow,
.afd__row {
  padding: 0.6rem 0;
  border-bottom: 1px dashed var(--tvz-hairline);
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.afd__vatrow:last-child,
.afd__row:last-child {
  border-bottom: none;
}
.afd__vatrow b,
.afd__row b {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.afd__reason {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.afd__catlist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.afd__catrow {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0.55rem 0;
  border-bottom: 1px dashed var(--tvz-hairline);
  font-size: 0.88rem;
}
.afd__catrow:last-child {
  border-bottom: none;
}
.afd__catrow--total {
  border-top: 1px solid var(--tvz-hairline);
  border-bottom: none;
  padding-top: 0.7rem;
  margin-top: 0.3rem;
  font-weight: 700;
}
.afd__catrow--sub {
  padding-left: 1rem;
  font-size: 0.8rem;
  border-bottom: none;
}
.afd__catrow--sub .afd__catlabel {
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.afd__catlabel {
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.afd__catvalue {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.afd__muted {
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.86rem;
  margin: 0;
}
.afd__hint {
  margin: 0.8rem 0 0;
  font-size: 0.74rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

@media (max-width: 1100px) {
  .afd__kpis--four {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 860px) {
  .afd__kpis,
  .afd__kpis--four {
    grid-template-columns: 1fr;
  }
  .afd__grid {
    grid-template-columns: 1fr;
  }
  /* Stacked rows lose their header, so every cell names itself. */
  .afd__vathead,
  .afd__rowhead {
    display: none;
  }
  .afd__vatrow,
  .afd__row,
  .afd__row--voided,
  .afd__row--company {
    grid-template-columns: 1fr 1fr;
    row-gap: 0.3rem;
    border-bottom: 1px solid var(--tvz-hairline);
  }
  .afd__vatrow span[data-label]::before,
  .afd__row span[data-label]::before {
    content: attr(data-label) ': ';
    color: rgba(var(--v-theme-on-surface), 0.45);
    font-size: 0.72rem;
  }
  .afd__reason {
    grid-column: span 2;
    white-space: normal;
  }
}
</style>
