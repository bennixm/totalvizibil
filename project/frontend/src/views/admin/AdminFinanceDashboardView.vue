<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminStatCard from '@/components/admin/AdminStatCard.vue'
import AdminSection from '@/components/admin/AdminSection.vue'
import { useAdminFinanceStore, type ExpenseCategory } from '@/stores/adminFinance'

const { t } = useI18n()
const finance = useAdminFinanceStore()

function eur(minor: number): string {
  return `${(minor / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
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
              <span class="afd__catlabel">{{ t('adminFinance.cpcRevenue') }}</span>
              <span class="afd__catvalue">{{ eur(finance.overview.paidTraffic.cpcRevenueMinor) }}</span>
            </li>
            <li class="afd__catrow">
              <span class="afd__catlabel">{{ t('adminFinance.adSpend') }}</span>
              <span class="afd__catvalue">{{ eur(finance.overview.paidTraffic.adSpendMinor) }}</span>
            </li>
            <li class="afd__catrow afd__catrow--total">
              <span class="afd__catlabel">{{ t('adminFinance.trafficProfit') }}</span>
              <span class="afd__catvalue">{{ eur(finance.overview.paidTraffic.profitMinor) }}</span>
            </li>
          </ul>
          <p class="afd__hint">{{ t('adminFinance.paidTrafficHint') }}</p>
        </AdminSection>
      </div>
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
.afd__grid {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 1rem;
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

@media (max-width: 860px) {
  .afd__kpis {
    grid-template-columns: 1fr;
  }
  .afd__grid {
    grid-template-columns: 1fr;
  }
}
</style>
