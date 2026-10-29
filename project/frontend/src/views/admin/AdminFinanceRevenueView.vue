<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminPager from '@/components/admin/AdminPager.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import { useAdminFinanceStore, type RevenueTxnType } from '@/stores/adminFinance'

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

/** `adjustment` rows (manual wallet corrections, affiliate-reward credits)
 *  are hidden by default — same rows the ledger has always shown. Only
 *  meaningful on "Toate"; a single-type filter wins server-side. */
const includeAdjustments = computed({
  get: () => finance.revenueFilters.includeAdjustments,
  set: (v: boolean) => finance.setRevenueFilter('includeAdjustments', v),
})

const TYPE_LABELS: Record<RevenueTxnType, string> = {
  purchase: 'Încărcare',
  refund: 'Rambursare',
  adjustment: 'Ajustare',
}
function typeLabel(type: RevenueTxnType): string {
  if (type === 'purchase') return t('adminFinance.purchase')
  if (type === 'refund') return t('adminFinance.refund')
  return TYPE_LABELS[type]
}
function typeClass(type: RevenueTxnType): string {
  if (type === 'purchase') return 'chip--ok'
  if (type === 'refund') return 'chip--warn'
  return 'chip--info'
}

/** The discount delta for the period: face value sold minus money collected.
 *  Shown only when it's non-zero, i.e. a discount was actually active. */
const discountDeltaMinor = computed(
  () => finance.revenuePeriodFaceTotalMinor - finance.revenuePeriodTotalMinor,
)

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

    <div class="afr__filters">
      <v-btn-toggle v-model="typeFilter" density="compact" mandatory variant="outlined" divided>
        <v-btn value="all" size="small">{{ t('adminFinance.all') }}</v-btn>
        <v-btn value="purchase" size="small">{{ t('adminFinance.purchases') }}</v-btn>
        <v-btn value="refund" size="small">{{ t('adminFinance.refunds') }}</v-btn>
      </v-btn-toggle>
      <v-switch
        v-model="includeAdjustments"
        :disabled="finance.revenueFilters.type !== null"
        label="Include ajustări de portofel"
        color="primary"
        density="compact"
        hide-details
        inset
      />
    </div>

    <div v-if="finance.loadingRevenue && !hasRows" class="afr__center">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <!-- A failed fetch is NOT "no revenue" — see the store's `errMsg`. -->
    <AdminEmptyState
      v-else-if="finance.revenueError"
      icon="mdi-alert-circle-outline"
      :text="finance.revenueError"
    />
    <AdminEmptyState v-else-if="!hasRows" icon="mdi-cash-multiple" :text="t('adminFinance.noRevenue')" />

    <div v-else class="rtable">
      <div class="rtable__head" aria-hidden="true">
        <span>{{ t('adminFinance.colDate') }}</span>
        <span>{{ t('adminFinance.colType') }}</span>
        <span>{{ t('adminFinance.colClient') }}</span>
        <span>{{ t('adminFinance.colBusiness') }}</span>
        <span>Credite</span>
        <span>Bani încasați</span>
      </div>

      <ul class="afr__list">
        <li v-for="r in finance.revenue" :key="r.id" class="rrow">
          <span class="rrow__cell" data-label="Dată">{{ dt(r.createdAt) }}</span>
          <span class="rrow__cell" data-label="Tip">
            <span class="chip" :class="typeClass(r.type)">{{ typeLabel(r.type) }}</span>
          </span>
          <span class="rrow__person">
            <span class="rrow__name">{{ r.userName ?? '—' }}</span>
            <span class="rrow__email">{{ r.userEmail }}</span>
          </span>
          <span class="rrow__cell" data-label="Afacere">{{ r.companyName ?? '—' }}</span>
          <span class="rrow__cell rrow__face" data-label="Credite">
            {{ eur(r.amountMinor) }}
          </span>
          <span class="rrow__cell" data-label="Bani încasați">
            <b>{{ eur(r.moneyMinor) }}</b>
          </span>
        </li>
      </ul>

      <!-- Period total, computed server-side over the FULL filtered set (not
           this page) — what an accountant reconciling a month needs. -->
      <div class="rtable__foot">
        <span class="rtable__footlabel">
          Total perioadă
          <small>{{ finance.revenueTotal }} tranzacții</small>
        </span>
        <span class="rtable__footvals">
          <span class="rtable__footval rtable__footval--muted">
            <small>Credite</small>
            {{ eur(finance.revenuePeriodFaceTotalMinor) }}
          </span>
          <span class="rtable__footval">
            <small>Bani încasați</small>
            <b>{{ eur(finance.revenuePeriodTotalMinor) }}</b>
          </span>
        </span>
      </div>
      <p v-if="discountDeltaMinor !== 0" class="afr__hint">
        Diferența de {{ eur(discountDeltaMinor) }} este costul discountului din perioadă
        (valoare nominală în credite minus banii încasați efectiv).
      </p>
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
.afr__filters {
  display: flex;
  align-items: center;
  gap: 1.4rem;
  flex-wrap: wrap;
  margin: 1.2rem 0 1.4rem;
}
.afr__hint {
  margin: 0.7rem 0 0;
  font-size: 0.74rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
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
  grid-template-columns:
    minmax(0, 0.8fr) minmax(0, 0.7fr) minmax(0, 1.2fr) minmax(0, 1fr)
    minmax(0, 0.7fr) minmax(0, 0.8fr);
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
.chip--info {
  background: rgba(var(--v-theme-info), 0.16);
  color: rgb(var(--v-theme-info));
}

.rrow__face {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-family: 'Space Grotesk Variable', sans-serif;
  font-variant-numeric: tabular-nums;
}

.rtable__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 0.85rem 1.1rem;
  border-top: 1px solid var(--tvz-glass-border);
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.rtable__footlabel {
  display: flex;
  flex-direction: column;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.rtable__footlabel small {
  font-size: 0.66rem;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  color: rgba(var(--v-theme-on-surface), 0.42);
}
.rtable__footvals {
  display: flex;
  gap: 1.6rem;
}
.rtable__footval {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-variant-numeric: tabular-nums;
  font-size: 1rem;
}
.rtable__footval small {
  font-family: inherit;
  font-size: 0.64rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.rtable__footval--muted {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.86rem;
}

@media (max-width: 860px) {
  .rtable__head {
    display: none;
  }
  .rrow {
    grid-template-columns: 1fr 1fr;
    row-gap: 0.4rem;
  }
  /* Stacked rows lose the header, so each cell names itself. */
  .rrow__cell[data-label]::before {
    content: attr(data-label) ': ';
    color: rgba(var(--v-theme-on-surface), 0.45);
    font-size: 0.72rem;
  }
  .rrow__person {
    grid-column: span 2;
  }
  .rtable__footvals {
    gap: 1rem;
  }
}
</style>
