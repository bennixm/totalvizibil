<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminStatCard from '@/components/admin/AdminStatCard.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import { useAdminFinanceStore } from '@/stores/adminFinance'

const { t, n } = useI18n()
const finance = useAdminFinanceStore()

function eur(minor: number): string {
  return `${(minor / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

const hasRows = computed(() => (finance.aiUsage?.byModel.length ?? 0) > 0)

/** This page has no period control of its own — it silently inherits
 *  `finance.period` from the Dashboard page, which is otherwise invisible
 *  here (looks identical to the default current-month window on a fresh
 *  page load). Surfacing the backend-returned range at least tells the
 *  admin what window the numbers below actually cover. */
const rangeLabel = computed(() => {
  const range = finance.aiUsage?.range
  if (!range) return ''
  const from = new Date(range.from).toLocaleDateString('ro-RO')
  const to = new Date(range.to).toLocaleDateString('ro-RO')
  return `${from} – ${to}`
})

onMounted(() => finance.fetchAiUsage())
</script>

<template>
  <div class="afa">
    <AdminPageHeader :title="t('adminFinance.aiTitle')" :eyebrow="t('admin.navGroupFinance')" :sub="t('adminFinance.aiLead')">
      <template #actions>
        <v-btn v-if="hasRows" :href="finance.aiUsageExportUrl()" variant="tonal" size="small" prepend-icon="mdi-file-pdf-box">
          {{ t('transactions.exportPdf') }}
        </v-btn>
      </template>
    </AdminPageHeader>

    <div v-if="finance.loadingAiUsage && !finance.aiUsage" class="afa__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="finance.aiUsage">
      <p v-if="rangeLabel" class="afa__range">{{ rangeLabel }}</p>
      <div class="afa__kpis">
        <AdminStatCard :label="t('adminFinance.aiTotalCost')" :value="eur(finance.aiUsage.totalCostMinor)" icon="mdi-cash-minus" tone="error" />
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
.afa__range {
  margin: 1rem 0 0;
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.afa__kpis {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.7rem;
  margin: 0.6rem 0 1.4rem;
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
