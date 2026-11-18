<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminStatCard from '@/components/admin/AdminStatCard.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import AdminPeriodFilter from '@/components/admin/AdminPeriodFilter.vue'
import { useMoney } from '@/composables/useMoney'
import { usePeriodFilter } from '@/composables/usePeriodFilter'
import { useAdminFinanceStore } from '@/stores/adminFinance'

const { t, n } = useI18n()
const finance = useAdminFinanceStore()
const money = useMoney()

function eur(minor: number): string {
  return money.fiat(minor / 100)
}
function dt(s: string): string {
  return new Date(s).toLocaleDateString('ro-RO')
}

const hasRows = computed(() => (finance.aiUsage?.byModel.length ?? 0) > 0)

// --- homepage "ask" search ---------------------------------------------
const search = computed(() => finance.aiUsage?.search ?? null)
const freeShare = computed(() => {
  const s = search.value
  if (!s?.searches) return 0
  return Math.round(((s.stored + s.keyword + s.local + s.guess) / s.searches) * 100)
})
/** Sub-cent spend must not read as "€0,00". */
function tinyMoney(minor: number, exact: number): string {
  return minor === 0 && exact > 0 ? `< ${eur(1)}` : eur(minor)
}
const searchParts = computed(() => {
  const s = search.value
  if (!s?.searches) return []
  return (
    [
      { key: 'stored', n: s.stored, cls: 'p1' },
      { key: 'keyword', n: s.keyword, cls: 'p2' },
      { key: 'local', n: s.local, cls: 'p3' },
      { key: 'ai', n: s.ai, cls: 'p4' },
      { key: 'guess', n: s.guess, cls: 'p5' },
    ] as const
  ).map((p) => ({ ...p, pct: (p.n / s.searches) * 100 }))
})

// Independent period filter — its own state/fetch (`setAiUsagePeriod`),
// same pattern as Venituri/Costuri/Dashboard. Used to silently inherit the
// Dashboard's period instead, with no control of its own to change it.
const { activePreset, customFrom, customTo, canApplyCustom, setQuickRange, applyCustomRange } =
  usePeriodFilter((from, to, lifetime) => finance.setAiUsagePeriod(from, to, lifetime))

const activeRangeLabel = computed(() => {
  const r = finance.aiUsage?.range
  if (!r) return ''
  if (!r.from && !r.to) return t('adminFinance.lifetime')
  return `${r.from ? dt(r.from) : '…'} – ${r.to ? dt(r.to) : '…'}`
})

onMounted(() => setQuickRange('month'))
</script>

<template>
  <div class="afa">
    <AdminPageHeader :title="t('adminFinance.aiTitle')" :eyebrow="t('admin.navGroupFinance')">
      <template #actions>
        <v-btn v-if="hasRows" :href="finance.aiUsageExportUrl()" variant="tonal" size="small" prepend-icon="mdi-file-pdf-box">
          {{ t('transactions.exportPdf') }}
        </v-btn>
      </template>
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

    <div v-if="finance.loadingAiUsage && !finance.aiUsage" class="afa__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <!-- Everything below is inside `v-else-if="finance.aiUsage"`, so a failed
         fetch left a blank page behind the spinner. -->
    <AdminEmptyState
      v-else-if="finance.aiUsageError"
      icon="mdi-alert-circle-outline"
      :text="finance.aiUsageError"
    />

    <template v-else-if="finance.aiUsage">
      <!-- Money first: what customers paid for AI usage (real money) vs
           what the platform paid the providers for it. `aiUsageOverview` is
           scoped to THIS page's own filter above — never the Dashboard's —
           so these cards can never silently show a different period than
           the cost/calls/tokens figures right below them. -->
      <div v-if="finance.aiUsageOverview" class="afa__kpis">
        <AdminStatCard :label="t('adminFinance.aiRevenue')" :value="eur(finance.aiUsageOverview.aiBuilder.promptRevenueRealMoneyMinor)" icon="mdi-bank-transfer-in" tone="primary" />
        <AdminStatCard :label="t('adminFinance.aiTotalCost')" :value="eur(finance.aiUsage.totalCostMinor)" icon="mdi-cash-minus" tone="error" />
        <AdminStatCard
          :label="t('adminFinance.aiProfit')"
          :value="eur(finance.aiUsageOverview.aiBuilder.promptProfitMinor)"
          icon="mdi-piggy-bank-outline"
          :tone="finance.aiUsageOverview.aiBuilder.promptProfitMinor >= 0 ? 'success' : 'error'"
        />
      </div>

      <div class="afa__kpis afa__kpis--two">
        <AdminStatCard :label="t('adminFinance.aiTotalCalls')" :value="n(finance.aiUsage.totalCalls)" icon="mdi-swap-horizontal" />
        <AdminStatCard :label="t('adminFinance.aiTotalTokens')" :value="n(finance.aiUsage.totalTokens)" icon="mdi-counter" />
      </div>

      <!-- Homepage "ask" search: most answers are free (stored answers,
           category names, the local model); only the rest reach Claude. -->
      <section v-if="search" class="afa__search">
        <h2 class="afa__h2">{{ t('adminFinance.searchTitle') }}</h2>
        <div class="afa__kpis afa__kpis--four">
          <AdminStatCard :label="t('adminFinance.searchCount')" :value="n(search.searches)" icon="mdi-magnify" />
          <AdminStatCard
            :label="t('adminFinance.searchFree')"
            :value="`${freeShare}%`"
            icon="mdi-gift-outline"
            tone="success"
            :hint="t('adminFinance.searchFreeHint')"
          />
          <AdminStatCard :label="t('adminFinance.searchAiCalls')" :value="n(search.ai)" icon="mdi-robot-outline" />
          <AdminStatCard
            :label="t('adminFinance.searchCost')"
            :value="tinyMoney(search.costMinor, search.costUsd)"
            icon="mdi-cash-minus"
            tone="error"
            :sub="search.ai ? t('adminFinance.searchAvg', { cost: `$${search.avgCostUsd.toFixed(5)}` }) : undefined"
          />
        </div>
        <template v-if="searchParts.length">
          <div class="afa__bar" role="img" :aria-label="t('adminFinance.searchSplit')">
            <span
              v-for="p in searchParts"
              v-show="p.n > 0"
              :key="p.key"
              :class="['afa__seg', `afa__seg--${p.cls}`]"
              :style="{ width: `${p.pct}%` }"
            />
          </div>
          <ul class="afa__legend">
            <li v-for="p in searchParts" :key="p.key">
              <i :class="['afa__dot', `afa__seg--${p.cls}`]" />
              {{ t(`adminFinance.searchVia.${p.key}`) }}
              <b>{{ n(p.n) }}</b>
            </li>
          </ul>
        </template>
        <p v-else class="afa__muted">{{ t('adminFinance.searchNone') }}</p>
      </section>

      <AdminEmptyState v-if="!hasRows" icon="mdi-robot-outline" :text="t('adminFinance.noAiUsage')" />

      <div v-else class="rtable">
        <div class="rtable__head" aria-hidden="true">
          <span>{{ t('adminFinance.colProvider') }}</span>
          <span>{{ t('adminFinance.colModel') }}</span>
          <span>{{ t('adminFinance.colCalls') }}</span>
          <span>{{ t('adminFinance.colTokens') }}</span>
          <span>{{ t('adminFinance.colAmount') }}</span>
          <span>{{ t('adminFinance.colCharged') }}</span>
        </div>
        <ul class="afa__list">
          <li v-for="row in finance.aiUsage.byModel" :key="`${row.provider}:${row.model}`" class="rrow">
            <span class="rrow__cell" :data-label="t('adminFinance.colProvider')">{{ row.provider }}</span>
            <span class="rrow__cell" :data-label="t('adminFinance.colModel')">{{ row.model }}</span>
            <span class="rrow__cell" :data-label="t('adminFinance.colCalls')">{{ n(row.calls) }}</span>
            <span class="rrow__cell" :data-label="t('adminFinance.colTokens')">{{ n(row.tokens) }}</span>
            <span class="rrow__cell" :data-label="t('adminFinance.colAmount')">{{ eur(row.costMinor) }}</span>
            <span class="rrow__cell" :data-label="t('adminFinance.colCharged')">
              <b>{{ eur(row.chargedMinor) }}</b>
            </span>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<style scoped>
.afa {
  max-width: 1100px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.afa__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.afa__kpis {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.7rem;
  margin: 0.6rem 0 1.4rem;
}
.afa__kpis--two {
  grid-template-columns: repeat(2, 1fr);
}
.afa__kpis--four {
  grid-template-columns: repeat(4, 1fr);
}

/* --- homepage search --- */
.afa__search {
  margin: 0 0 1.8rem;
}
.afa__h2 {
  margin: 0.4rem 0 0.2rem;
  font-family: 'Space Grotesk Variable', sans-serif;
  /* A section title like every other (AdminSection) — was 1.05rem. */
  font-size: var(--tvz-fs-section);
  font-weight: 700;
}
.afa__bar {
  display: flex;
  height: 12px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.afa__seg {
  height: 100%;
}
.afa__seg--p1 {
  background: rgb(var(--v-theme-primary));
}
.afa__seg--p2 {
  background: rgba(var(--v-theme-primary), 0.55);
}
.afa__seg--p3 {
  background: rgb(var(--v-theme-success));
}
.afa__seg--p4 {
  background: rgb(var(--v-theme-error));
}
.afa__seg--p5 {
  background: rgba(var(--v-theme-on-surface), 0.3);
}
.afa__legend {
  list-style: none;
  margin: 0.7rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1.2rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.afa__legend li {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.afa__legend b {
  color: rgb(var(--v-theme-on-surface));
  font-variant-numeric: tabular-nums;
}
.afa__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
.afa__muted {
  margin: 0;
  font-size: var(--tvz-fs-body);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
@media (max-width: 1100px) {
  .afa__kpis--four {
    grid-template-columns: repeat(2, 1fr);
  }
}
.afa__list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.rtable {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  overflow: hidden;
}
.rtable__head,
.rrow {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr) minmax(0, 0.6fr) minmax(0, 0.8fr) minmax(0, 0.8fr) minmax(0, 0.8fr);
  align-items: center;
  gap: 1rem;
}
.rtable__head {
  padding: 0.65rem 1.1rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.45);
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-bottom: 1px solid var(--tvz-hairline);
}
.rrow {
  padding: 0.6rem 1.1rem;
  border-bottom: 1px solid var(--tvz-hairline);
  background: rgb(var(--v-theme-surface));
}
.rrow:last-child {
  border-bottom: none;
}
.rrow__cell {
  font-size: var(--tvz-fs-body);
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.rrow__cell b {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 860px) {
  .afa__kpis {
    grid-template-columns: 1fr;
  }
  .rtable__head {
    display: none;
  }
  .rrow {
    grid-template-columns: 1fr 1fr;
    row-gap: 0.4rem;
  }
  .rrow__cell[data-label]::before {
    content: attr(data-label) ': ';
    color: rgba(var(--v-theme-on-surface), 0.45);
    font-size: var(--tvz-fs-caption);
  }
}
</style>
