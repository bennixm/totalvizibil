<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminPager from '@/components/admin/AdminPager.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import { useAdminFinanceStore } from '@/stores/adminFinance'

const { t } = useI18n()
const finance = useAdminFinanceStore()

function eur(minor: number): string {
  return `${(minor / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}
function dt(s: string): string {
  return new Date(s).toLocaleDateString('ro-RO')
}

const hasRows = computed(() => finance.revenue.length > 0)

const typeFilter = computed({
  get: () => finance.revenueFilters.type ?? 'all',
  set: (v: 'all' | 'purchase' | 'refund') => finance.setRevenueFilter('type', v === 'all' ? null : v),
})

onMounted(() => finance.fetchRevenue())
</script>

<template>
  <div class="afr">
    <AdminPageHeader :title="t('adminFinance.revenueTitle')" :eyebrow="t('admin.navGroupFinance')" :count="finance.revenueTotal" :sub="t('adminFinance.revenueLead')">
      <template #actions>
        <v-btn v-if="hasRows" :href="finance.revenueExportUrl()" variant="tonal" size="small" prepend-icon="mdi-file-pdf-box">
          {{ t('transactions.exportPdf') }}
        </v-btn>
      </template>
    </AdminPageHeader>

    <v-btn-toggle v-model="typeFilter" density="compact" mandatory variant="outlined" divided class="afr__toggle">
      <v-btn value="all" size="small">{{ t('adminFinance.all') }}</v-btn>
      <v-btn value="purchase" size="small">{{ t('adminFinance.purchases') }}</v-btn>
      <v-btn value="refund" size="small">{{ t('adminFinance.refunds') }}</v-btn>
    </v-btn-toggle>

    <div v-if="finance.loadingRevenue && !hasRows" class="afr__center">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <AdminEmptyState v-else-if="!hasRows" icon="mdi-cash-multiple" :text="t('adminFinance.noRevenue')" />

    <div v-else class="rtable">
      <div class="rtable__head" aria-hidden="true">
        <span>{{ t('adminFinance.colDate') }}</span>
        <span>{{ t('adminFinance.colType') }}</span>
        <span>{{ t('adminFinance.colClient') }}</span>
        <span>{{ t('adminFinance.colBusiness') }}</span>
        <span>{{ t('adminFinance.colAmount') }}</span>
      </div>

      <ul class="afr__list">
        <li v-for="r in finance.revenue" :key="r.id" class="rrow">
          <span class="rrow__cell">{{ dt(r.createdAt) }}</span>
          <span class="rrow__cell">
            <span class="chip" :class="r.type === 'purchase' ? 'chip--ok' : 'chip--warn'">
              {{ r.type === 'purchase' ? t('adminFinance.purchase') : t('adminFinance.refund') }}
            </span>
          </span>
          <span class="rrow__person">
            <span class="rrow__name">{{ r.userName ?? '—' }}</span>
            <span class="rrow__email">{{ r.userEmail }}</span>
          </span>
          <span class="rrow__cell">{{ r.companyName ?? '—' }}</span>
          <span class="rrow__cell">
            <b>{{ eur(r.amountMinor) }}</b>
          </span>
        </li>
      </ul>
    </div>

    <AdminPager
      :page="finance.revenueFilters.page"
      :page-size="finance.revenueFilters.pageSize"
      :total="finance.revenueTotal"
      @update:page="finance.setRevenueFilter('page', $event)"
    />
  </div>
</template>

<style scoped>
.afr {
  max-width: 1100px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.afr__toggle {
  margin: 1.2rem 0 1.4rem;
}
.afr__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.afr__list {
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
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 0.8fr) minmax(0, 1.3fr) minmax(0, 1.1fr) minmax(0, 0.8fr);
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
  padding: 0.85rem 1.1rem;
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
.rrow__person {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.rrow__name {
  font-weight: 600;
  font-size: 0.86rem;
}
.rrow__email {
  font-size: 0.74rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip {
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.12rem 0.4rem;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.chip--ok {
  background: rgba(var(--v-theme-success), 0.16);
  color: rgb(var(--v-theme-success));
}
.chip--warn {
  background: rgba(var(--v-theme-warning), 0.16);
  color: rgb(var(--v-theme-warning));
}

@media (max-width: 860px) {
  .rtable__head {
    display: none;
  }
  .rrow {
    grid-template-columns: 1fr 1fr;
    row-gap: 0.4rem;
  }
}
</style>
