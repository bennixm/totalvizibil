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

// Independent period filter — its own state/fetch (`setAiUsagePeriod`),
// same pattern as Venituri/Costuri/Dashboard. Used to silently inherit the
// Dashboard's period instead, with no control of its own to change it.
const { activePreset, customFrom, customTo, canApplyCustom, setQuickRange, applyCustomRange } =
  usePeriodFilter((from, to, lifetime) => finance.setAiUsagePeriod(from, to, lifetime))

const activeRangeLabel = computed(() => {
  const r = finance.aiUsage?.range
  return r ? `${dt(r.from)} – ${dt(r.to)}` : ''
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

      <AdminEmptyState v-if="!hasRows" icon="mdi-robot-outline" :text="t('adminFinance.noAiUsage')" />

      <div v-else class="rtable">
        <div class="rtable__head" aria-hidden="true">
          <span>{{ t('adminFinance.colProvider') }}</span>
          <span>{{ t('adminFinance.colModel') }}</span>
          <span>{{ t('adminFinance.colCalls') }}</span>
          <span>{{ t('adminFinance.colTokens') }}</span>
          <span>{{ t('adminFinance.colAmount') }}</span>
        </div>
        <ul class="afa__list">
          <li v-for="row in finance.aiUsage.byModel" :key="`${row.provider}:${row.model}`" class="rrow">
            <span class="rrow__cell">{{ row.provider }}</span>
            <span class="rrow__cell">{{ row.model }}</span>
            <span class="rrow__cell">{{ n(row.calls) }}</span>
            <span class="rrow__cell">{{ n(row.tokens) }}</span>
            <span class="rrow__cell"><b>{{ eur(row.costMinor) }}</b></span>
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
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr) minmax(0, 0.6fr) minmax(0, 0.8fr) minmax(0, 0.8fr);
  align-items: center;
  gap: 1rem;
}
.rtable__head {
  padding: 0.65rem 1.1rem;
  font-size: 0.66rem;
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
  font-size: 0.86rem;
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
}
</style>
