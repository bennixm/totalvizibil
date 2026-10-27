<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminStatCard from '@/components/admin/AdminStatCard.vue'
import AdminSection from '@/components/admin/AdminSection.vue'
import AdminPager from '@/components/admin/AdminPager.vue'
import TrendChart from '@/components/TrendChart.vue'
import { useAdminFinanceStore, type ExpenseCategory } from '@/stores/adminFinance'

const { t } = useI18n()
const finance = useAdminFinanceStore()

function eur(minor: number): string {
  return `${(minor / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}
function pct(value: number): string {
  return `${value.toLocaleString('ro-RO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}
function dt(s: string): string {
  return new Date(s).toLocaleDateString('ro-RO')
}

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  hosting: 'Hosting',
  call_center: 'Centrală apeluri',
  cloud_storage: 'Stocare cloud',
  domains: 'Domenii',
  google_ads: 'Google Ads',
  stripe_fees: 'Comision Stripe',
  other: 'Altele',
}

const categoryRows = computed(() => {
  const o = finance.overview
  if (!o) return []
  return (Object.keys(CATEGORY_LABELS) as ExpenseCategory[])
    .map((key) => ({ key, label: CATEGORY_LABELS[key], amountMinor: o.expensesByCategory[key] }))
    .concat([{ key: 'ai_api' as ExpenseCategory, label: t('adminFinance.aiCost'), amountMinor: o.aiCostMinor }])
    .filter((r) => r.amountMinor > 0)
    .sort((a, b) => b.amountMinor - a.amountMinor)
})

const ONE_OFF_LABELS = {
  aiUsage: 'Consum AI (builder)',
  builderUnlock: 'Deblocare builder avansat',
  other: 'Alte taxe unice',
} as const

const oneOffRows = computed(() => {
  const o = finance.overview
  if (!o) return []
  return (Object.keys(ONE_OFF_LABELS) as (keyof typeof ONE_OFF_LABELS)[])
    .map((key) => ({ key, label: ONE_OFF_LABELS[key], amountMinor: o.otherFeesByCategory[key] }))
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
    label: 'Rambursări / venit',
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

function setQuickRange(months: number): void {
  const now = new Date()
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1))
  finance.setPeriod(from.toISOString().slice(0, 10), null)
}

onMounted(() => finance.fetchOverview())
</script>

<template>
  <div class="afd">
    <AdminPageHeader :title="t('adminFinance.dashboardTitle')" :eyebrow="t('admin.navGroupFinance')" :sub="t('adminFinance.dashboardLead')">
      <template #actions>
        <v-btn-toggle density="compact" mandatory variant="outlined" divided>
          <v-btn size="small" @click="setQuickRange(1)">{{ t('adminFinance.thisMonth') }}</v-btn>
          <v-btn size="small" @click="setQuickRange(3)">{{ t('adminFinance.last3Months') }}</v-btn>
          <v-btn size="small" @click="setQuickRange(12)">{{ t('adminFinance.last12Months') }}</v-btn>
        </v-btn-toggle>
      </template>
    </AdminPageHeader>

    <div v-if="finance.loadingOverview && !finance.overview" class="afd__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="finance.overview">
      <div class="afd__kpis">
        <AdminStatCard :label="t('adminFinance.revenue')" :value="eur(finance.overview.revenueMinor)" icon="mdi-cash-plus" tone="primary" />
        <AdminStatCard :label="t('adminFinance.costs')" :value="eur(finance.overview.totalCostMinor)" icon="mdi-cash-minus" tone="error" />
        <AdminStatCard
          :label="t('adminFinance.netProfit')"
          :value="eur(finance.overview.profitMinor)"
          icon="mdi-piggy-bank-outline"
          :tone="finance.overview.profitMinor >= 0 ? 'success' : 'error'"
        />
      </div>

      <!-- Gross (credit face value sold) vs net (money collected); the delta
           is what the discount cost over this period. -->
      <div class="afd__kpis afd__kpis--four">
        <AdminStatCard
          label="Valoare nominală vândută"
          :value="eur(finance.overview.grossRevenueMinor)"
          sub="Credite la preț de listă"
          icon="mdi-tag-outline"
        />
        <AdminStatCard
          label="Bani încasați"
          :value="eur(finance.overview.netRevenueMinor)"
          sub="Fără rambursări"
          icon="mdi-bank-transfer-in"
          tone="primary"
        />
        <AdminStatCard
          label="Cost discount"
          :value="eur(finance.overview.discountCostMinor)"
          :sub="`Încasat ${pct(finance.overview.grossToNetRatio * 100)} din nominal`"
          icon="mdi-sale"
          :tone="finance.overview.discountCostMinor > 0 ? 'warning' : undefined"
        />
        <AdminStatCard
          label="Comisioane rambursare"
          :value="eur(finance.overview.refundFeeIncomeMinor)"
          sub="Venit reținut din rambursări"
          icon="mdi-cash-refund"
          tone="success"
        />
      </div>

      <!-- Point-in-time balance-sheet figures: these ignore the period
           filter on purpose (a liability is what's owed right now). -->
      <div class="afd__kpis afd__kpis--four">
        <AdminStatCard
          label="Credit în circulație"
          :value="eur(finance.overview.walletLiabilityMinor)"
          sub="Vândut, neconsumat (total)"
          icon="mdi-wallet-outline"
          tone="warning"
        />
        <AdminStatCard
          label="Sold blocat"
          :value="eur(finance.overview.blockedWalletBalanceMinor)"
          sub="Portofele înghețate (total)"
          icon="mdi-lock-outline"
        />
        <AdminStatCard
          label="Rambursări în curs"
          :value="eur(finance.overview.refundLiabilityInFlightMinor)"
          sub="Promise, neplătite (total)"
          icon="mdi-progress-clock"
        />
        <AdminStatCard
          label="Rată rambursări"
          :value="pct(finance.overview.refundRatioPct)"
          :sub="`${eur(finance.overview.refundsMoneyMinor)} returnați`"
          icon="mdi-undo-variant"
        />
      </div>

      <AdminSection title="Evoluție zilnică" icon="mdi-chart-line" class="afd__chart">
        <TrendChart
          v-if="hasTrend"
          :labels="trendLabels"
          :series="moneySeries"
          :format="eurAxis"
        />
        <p v-else class="afd__muted">Nicio mișcare în perioada selectată.</p>
      </AdminSection>

      <AdminSection
        v-if="hasTrend"
        title="Rambursări ca procent din venitul zilei"
        icon="mdi-chart-bell-curve-cumulative"
        class="afd__chart"
      >
        <TrendChart :labels="trendLabels" :series="refundRatioSeries" :format="pctAxis" />
        <p class="afd__hint">
          Raportul dintre banii returnați și banii încasați în aceeași zi, calculat cu
          aceleași reguli (comision reținut, discount) ca venitul din capul paginii.
        </p>
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

        <AdminSection :title="t('adminFinance.paidTraffic')" icon="mdi-google-ads">
          <ul class="afd__catlist">
            <li class="afd__catrow">
              <span class="afd__catlabel">{{ t('adminFinance.cpcRevenue') }} (credite)</span>
              <span class="afd__catvalue">{{ eur(finance.overview.paidTraffic.cpcRevenueMinor) }}</span>
            </li>
            <li class="afd__catrow">
              <span class="afd__catlabel">{{ t('adminFinance.cpcRevenue') }} (bani reali)</span>
              <span class="afd__catvalue">{{ eur(finance.overview.paidTraffic.cpcRevenueRealMoneyMinor) }}</span>
            </li>
            <li class="afd__catrow">
              <span class="afd__catlabel">{{ t('adminFinance.adSpend') }}</span>
              <span class="afd__catvalue">{{ eur(finance.overview.paidTraffic.adSpendMinor) }}</span>
            </li>
            <li class="afd__catrow afd__catrow--total">
              <span class="afd__catlabel">{{ t('adminFinance.trafficProfit') }} (bani reali)</span>
              <span class="afd__catvalue">{{ eur(finance.overview.paidTraffic.realMoneyProfitMinor) }}</span>
            </li>
          </ul>
          <p class="afd__hint">{{ t('adminFinance.paidTrafficHint') }}</p>
        </AdminSection>

        <!-- The CPC-vs-one-off split, labelled for what it is. -->
        <AdminSection title="Consum de credit: recurent vs unic" icon="mdi-repeat-variant">
          <ul class="afd__catlist">
            <li class="afd__catrow">
              <span class="afd__catlabel">Recurent (clicuri CPC)</span>
              <span class="afd__catvalue">{{ eur(finance.overview.creditConsumption.recurringMinor) }}</span>
            </li>
            <li class="afd__catrow">
              <span class="afd__catlabel">Unic (taxe punctuale)</span>
              <span class="afd__catvalue">{{ eur(finance.overview.creditConsumption.oneTimeMinor) }}</span>
            </li>
            <li v-for="row in oneOffRows" :key="row.key" class="afd__catrow afd__catrow--sub">
              <span class="afd__catlabel">{{ row.label }}</span>
              <span class="afd__catvalue">{{ eur(row.amountMinor) }}</span>
            </li>
            <li class="afd__catrow afd__catrow--total">
              <span class="afd__catlabel">Total consumat</span>
              <span class="afd__catvalue">
                {{ eur(finance.overview.creditConsumption.recurringMinor + finance.overview.creditConsumption.oneTimeMinor) }}
              </span>
            </li>
          </ul>
          <p class="afd__hint">
            Valoare nominală în credite. Taxele unice sunt clasificate identic cu
            defalcarea din portofelul clientului.
          </p>
        </AdminSection>

        <AdminSection title="TVA pe cote (facturi valide)" icon="mdi-percent-outline" wide>
          <div v-if="finance.overview.vatBreakdown.length" class="afd__vat">
            <div class="afd__vathead" aria-hidden="true">
              <span>Cotă</span>
              <span>Facturi</span>
              <span>Bază</span>
              <span>TVA</span>
              <span>Total</span>
            </div>
            <div
              v-for="row in finance.overview.vatBreakdown"
              :key="`${row.vatRatePct}-${row.currency}`"
              class="afd__vatrow"
            >
              <span data-label="Cotă">{{ row.vatRatePct }}% · {{ row.currency }}</span>
              <span data-label="Facturi">{{ row.invoiceCount }}</span>
              <span data-label="Bază">{{ eur(row.subtotalMinor) }}</span>
              <span data-label="TVA">{{ eur(row.vatMinor) }}</span>
              <span data-label="Total"><b>{{ eur(row.totalMinor) }}</b></span>
            </div>
          </div>
          <p v-else class="afd__muted">Nicio factură emisă în perioada selectată.</p>
          <p class="afd__hint">
            Sumele sunt în moneda facturii (RON pentru facturile fiscale), nu convertite.
          </p>
        </AdminSection>
      </div>

      <!-- Drill-downs on the same page: no new routes. -->
      <AdminSection class="afd__drill" wide>
        <v-tabs v-model="drillTab" density="compact" class="afd__tabs">
          <v-tab value="voided">Facturi anulate</v-tab>
          <v-tab value="companies">Top afaceri (CPC)</v-tab>
        </v-tabs>

        <v-window v-model="drillTab" class="afd__window">
          <v-window-item value="voided">
            <div class="afd__drillhead">
              <span>{{ finance.voidedInvoicesTotal }} facturi anulate în perioadă</span>
              <b>{{ eur(finance.voidedInvoicesSumMinor) }}</b>
            </div>
            <div v-if="finance.loadingVoidedInvoices" class="afd__center">
              <v-progress-circular indeterminate color="primary" size="28" />
            </div>
            <p v-else-if="!finance.voidedInvoices.length" class="afd__muted">
              Nicio factură anulată în perioada selectată.
            </p>
            <div v-else class="afd__rows">
              <div class="afd__rowhead afd__rowhead--voided" aria-hidden="true">
                <span>Număr</span>
                <span>Client</span>
                <span>Anulată la</span>
                <span>Motiv</span>
                <span>Total</span>
              </div>
              <div
                v-for="inv in finance.voidedInvoices"
                :key="inv.id"
                class="afd__row afd__row--voided"
              >
                <span data-label="Număr"><b>{{ inv.number }}</b></span>
                <span data-label="Client">{{ inv.buyerName }}</span>
                <span data-label="Anulată la">{{ dt(inv.voidedAt) }}</span>
                <span data-label="Motiv" class="afd__reason">{{ inv.voidReason ?? '—' }}</span>
                <span data-label="Total">
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
              <span>{{ finance.topCompaniesTotal }} afaceri cu consum CPC în perioadă</span>
              <b>{{ eur(finance.topCompaniesSpendMinor) }}</b>
            </div>
            <div v-if="finance.loadingTopCompanies" class="afd__center">
              <v-progress-circular indeterminate color="primary" size="28" />
            </div>
            <p v-else-if="!finance.topCompanies.length" class="afd__muted">
              Nicio afacere nu a consumat buget CPC în perioada selectată.
            </p>
            <div v-else class="afd__rows">
              <div class="afd__rowhead afd__rowhead--company" aria-hidden="true">
                <span>Afacere</span>
                <span>Clicuri</span>
                <span>Consum</span>
              </div>
              <div
                v-for="c in finance.topCompanies"
                :key="c.companyId"
                class="afd__row afd__row--company"
              >
                <span data-label="Afacere"><b>{{ c.companyName ?? '—' }}</b></span>
                <span data-label="Clicuri">{{ c.clicks.toLocaleString('ro-RO') }}</span>
                <span data-label="Consum">{{ eur(c.spendMinor) }}</span>
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
.afd__chart {
  margin-bottom: 1rem;
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
