<script setup lang="ts">
/**
 * The annual report: one row per calendar month (cash, VAT, earned revenue,
 * expenses, profit) plus the year total, exportable as PDF / Excel / CSV.
 * Clicking a month opens that month's full statement.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import AdminExportMenu from '@/components/admin/AdminExportMenu.vue'
import FinanceStatementTable from '@/components/admin/finance/FinanceStatementTable.vue'
import { useMoney } from '@/composables/useMoney'
import { useAdminFinanceStore, type FinancialStatement } from '@/stores/adminFinance'

const { t, locale } = useI18n()
const finance = useAdminFinanceStore()
const money = useMoney()
const eur = (minor: number) => money.fiat(minor / 100)

const currentYear = new Date().getUTCFullYear()
const YEARS = Array.from({ length: Math.max(1, currentYear - 2024) }, (_, i) => currentYear - i)
const year = ref(currentYear)
const openMonth = ref<number | null>(null)

const COLUMNS: { key: string; pick: (s: FinancialStatement) => number; strong?: boolean }[] = [
  { key: 'colCashNet', pick: (s) => s.cash.netMinor },
  { key: 'colVat', pick: (s) => s.cash.netVatMinor },
  { key: 'colRevenue', pick: (s) => s.revenue.totalNetMinor },
  { key: 'colExpenses', pick: (s) => s.expenses.totalMinor },
  { key: 'colProfit', pick: (s) => s.result.operatingProfitMinor, strong: true },
]

function monthName(i: number): string {
  return new Date(Date.UTC(2026, i, 1)).toLocaleDateString(locale.value, { month: 'long', timeZone: 'UTC' })
}

const rows = computed(() => finance.monthly?.months ?? [])
const opened = computed(() => (openMonth.value === null ? null : rows.value[openMonth.value] ?? null))

watch(year, (y) => {
  openMonth.value = null
  void finance.fetchMonthly(y)
})
onMounted(() => {
  if (finance.monthly?.year !== year.value) void finance.fetchMonthly(year.value)
})
</script>

<template>
  <div class="fat">
    <div class="fat__bar">
      <v-select
        v-model="year"
        :items="YEARS"
        :label="t('adminFinance.periodYear')"
        density="compact"
        hide-details
        style="max-width: 130px"
      />
      <v-spacer />
      <AdminExportMenu
        :url-for="(f) => finance.reportExportUrl(f, year)"
        :label="t('adminFinance.exportAnnual')"
      />
    </div>

    <div v-if="finance.loadingMonthly && !finance.monthly" class="fat__center">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <AdminEmptyState v-else-if="finance.monthlyError" icon="mdi-alert-circle-outline" :text="finance.monthlyError" />

    <template v-else-if="finance.monthly">
      <div class="fat__scroll">
        <table class="fat__table">
          <thead>
            <tr>
              <th scope="col">{{ t('adminFinance.annual.colMonth') }}</th>
              <th v-for="c in COLUMNS" :key="c.key" scope="col">{{ t(`adminFinance.annual.${c.key}`) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(m, i) in rows"
              :key="m.range.from"
              :class="{ 'is-open': openMonth === i }"
              tabindex="0"
              @click="openMonth = openMonth === i ? null : i"
              @keydown.enter="openMonth = openMonth === i ? null : i"
            >
              <th scope="row">{{ monthName(i) }}</th>
              <td
                v-for="c in COLUMNS"
                :key="c.key"
                :class="{ 'is-neg': c.pick(m) < 0, 'is-strong': c.strong }"
              >
                {{ eur(c.pick(m)) }}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{{ t('adminFinance.annual.total', { year: finance.monthly.year }) }}</th>
              <td
                v-for="c in COLUMNS"
                :key="c.key"
                :class="{ 'is-neg': c.pick(finance.monthly.total) < 0 }"
              >
                {{ eur(c.pick(finance.monthly.total)) }}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p class="fat__hint">{{ t('adminFinance.annual.hint') }}</p>

      <div v-if="opened && openMonth !== null" class="fat__detail">
        <div class="fat__detailhead">
          <b>{{ monthName(openMonth) }} {{ finance.monthly.year }}</b>
          <v-btn icon="mdi-close" variant="text" size="small" :aria-label="t('common.close')" @click="openMonth = null" />
        </div>
        <FinanceStatementTable :statement="opened" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.fat__bar {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin-bottom: 1rem;
}
.fat__center {
  display: grid;
  place-items: center;
  min-height: 160px;
}
.fat__scroll {
  overflow-x: auto;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
}
.fat__table {
  width: 100%;
  min-width: 680px;
  border-collapse: collapse;
  font-size: var(--tvz-fs-small);
}
.fat__table th,
.fat__table td {
  padding: 0.6rem 0.8rem;
  text-align: right;
  border-bottom: 1px solid var(--tvz-hairline);
  white-space: nowrap;
}
.fat__table th:first-child {
  text-align: left;
  text-transform: capitalize;
}
.fat__table thead th {
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.5);
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.fat__table tbody tr {
  cursor: pointer;
}
.fat__table tbody tr:hover,
.fat__table tbody tr.is-open {
  background: rgba(var(--v-theme-primary), 0.05);
}
.fat__table tbody th {
  font-weight: 600;
}
.fat__table td {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-variant-numeric: tabular-nums;
}
.fat__table td.is-strong {
  font-weight: 700;
}
.fat__table td.is-neg {
  color: rgb(var(--v-theme-error));
}
.fat__table tfoot th,
.fat__table tfoot td {
  font-weight: 800;
  border-bottom: none;
  background: rgba(var(--v-theme-primary), 0.06);
}
.fat__hint {
  margin: 0.6rem 0 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.fat__detail {
  margin-top: 1.2rem;
  padding: 1rem 1.1rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
}
.fat__detailhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  text-transform: capitalize;
}
</style>
