<script setup lang="ts">
/**
 * The transaction register: every wallet movement of the period, searchable
 * and filterable the way an accountant reconciles a month (by type, status,
 * amount, client / invoice / payment reference), with per-type subtotals and
 * PDF / Excel / CSV exports of exactly the filtered set.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminPager from '@/components/admin/AdminPager.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import AdminStatCard from '@/components/admin/AdminStatCard.vue'
import AdminPeriodFilter from '@/components/admin/AdminPeriodFilter.vue'
import AdminExportMenu from '@/components/admin/AdminExportMenu.vue'
import AdminHint from '@/components/admin/AdminHint.vue'
import { useMoney } from '@/composables/useMoney'
import { usePeriodFilter } from '@/composables/usePeriodFilter'
import {
  useAdminFinanceStore,
  type RevenueRow,
  type RevenueTxnType,
  type TxnSort,
  type TxnStatusFilter,
} from '@/stores/adminFinance'

const { t } = useI18n()
const finance = useAdminFinanceStore()
const money = useMoney()

function eur(minor: number): string {
  return money.fiat(minor / 100)
}
function dt(s: string): string {
  return new Date(s).toLocaleDateString('ro-RO')
}
function time(s: string): string {
  return new Date(s).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })
}

const {
  activePreset,
  customFrom,
  customTo,
  canApplyCustom,
  setQuickRange,
  applyCustomRange,
  pickMonth,
  pickYear,
} = usePeriodFilter((from, to, lifetime) => finance.setRevenuePeriod(from, to, lifetime))

const activeRangeLabel = computed(() => {
  const r = finance.revenueRange
  if (!r) return ''
  if (!r.from && !r.to) return t('adminFinance.lifetime')
  return `${r.from ? dt(r.from) : '…'} – ${r.to ? dt(r.to) : '…'}`
})

const hasRows = computed(() => finance.revenue.length > 0)
const f = finance.revenueFilters

// --- filters ---------------------------------------------------------------
const TYPES: RevenueTxnType[] = ['purchase', 'refund', 'adjustment', 'spend']
const types = computed({
  get: () => f.types,
  set: (v: RevenueTxnType[]) => finance.setRevenueFilter('types', v.length ? v : ['purchase', 'refund']),
})
const STATUSES = computed<{ value: TxnStatusFilter; title: string }[]>(() =>
  (['completed', 'pending', 'processing', 'failed', 'canceled', 'all'] as TxnStatusFilter[]).map((v) => ({
    value: v,
    title: t(`adminFinance.status.${v}`),
  })),
)
const SORTS = computed<{ value: TxnSort; title: string }[]>(() =>
  (['date_desc', 'date_asc', 'amount_desc', 'amount_asc'] as TxnSort[]).map((v) => ({
    value: v,
    title: t(`adminFinance.sort.${v}`),
  })),
)

// Search + amount bounds are typed: debounced so each keystroke isn't a request.
const search = ref(f.q)
const minAmount = ref<string>(f.minAmount === null ? '' : String(f.minAmount))
const maxAmount = ref<string>(f.maxAmount === null ? '' : String(f.maxAmount))
let timer: ReturnType<typeof setTimeout> | undefined
function debounced(fn: () => void): void {
  clearTimeout(timer)
  timer = setTimeout(fn, 350)
}
watch(search, (v) => debounced(() => finance.setRevenueFilter('q', v)))
function num(v: string): number | null {
  const n = Number(String(v).replace(',', '.'))
  return v === '' || !Number.isFinite(n) || n < 0 ? null : n
}
watch(minAmount, (v) => debounced(() => finance.setRevenueFilter('minAmount', num(v))))
watch(maxAmount, (v) => debounced(() => finance.setRevenueFilter('maxAmount', num(v))))

const filtersActive = computed(
  () =>
    !!f.q ||
    f.status !== 'completed' ||
    f.minAmount !== null ||
    f.maxAmount !== null ||
    f.sort !== 'date_desc' ||
    f.types.length !== 2 ||
    !f.types.includes('purchase') ||
    !f.types.includes('refund'),
)
function resetFilters(): void {
  search.value = ''
  minAmount.value = ''
  maxAmount.value = ''
  finance.resetRevenueFilters()
}

// --- rows ------------------------------------------------------------------
function typeLabel(r: RevenueRow): string {
  if (r.type === 'spend' && r.category) return t(`adminFinance.consumption.${r.category}`)
  return t(`adminFinance.txnType.${r.type}`)
}
function typeClass(type: RevenueTxnType): string {
  return { purchase: 'chip--ok', refund: 'chip--warn', adjustment: 'chip--info', spend: '' }[type]
}

const discountDeltaMinor = computed(() => {
  const p = finance.revenueByType?.purchase
  return p ? p.amountMinor - p.moneyMinor : 0
})

onMounted(() => setQuickRange('month'))
</script>

<template>
  <div class="afr">
    <AdminPageHeader :title="t('adminFinance.revenueTitle')" :eyebrow="t('admin.navGroupFinance')" :count="finance.revenueTotal">
      <template #actions>
        <AdminExportMenu :url-for="(fmt) => finance.revenueExportUrl(fmt)" :disabled="!hasRows" />
      </template>
    </AdminPageHeader>

    <AdminPeriodFilter
      v-model:custom-from="customFrom"
      v-model:custom-to="customTo"
      :preset="activePreset"
      :can-apply-custom="canApplyCustom"
      :active-range-label="activeRangeLabel"
      calendar-pickers
      @preset="setQuickRange"
      @apply="applyCustomRange"
      @pick-month="pickMonth"
      @pick-year="pickYear"
    />

    <!-- Same real-money figure the Dashboard's cash KPI reconciles to (same
         ledger rows, same money math), over whatever is filtered here. -->
    <div class="afr__kpis">
      <AdminStatCard
        :label="t('adminFinance.registerMoney')"
        :value="eur(finance.revenuePeriodTotalMinor)"
        :hint="t('adminFinance.registerMoneyHint')"
        icon="mdi-bank-transfer-in"
        tone="primary"
        :to="{ name: 'admin-financiar' }"
      />
      <AdminStatCard
        :label="t('adminFinance.faceValueCredits')"
        :value="eur(finance.revenuePeriodFaceTotalMinor)"
        icon="mdi-tag-outline"
      />
    </div>

    <div v-if="finance.revenueByType" class="afr__subtotals">
      <template v-for="ty in TYPES" :key="ty">
        <span v-if="finance.revenueByType[ty].count" class="afr__subtotal">
          <span class="chip" :class="typeClass(ty)">{{ t(`adminFinance.txnTypePlural.${ty}`) }}</span>
          <b>{{ finance.revenueByType[ty].count }}</b>
          <span>{{ eur(ty === 'purchase' || ty === 'refund' ? finance.revenueByType[ty].moneyMinor : finance.revenueByType[ty].amountMinor) }}</span>
        </span>
      </template>
    </div>

    <div class="afr__filters">
      <v-text-field
        v-model="search"
        prepend-inner-icon="mdi-magnify"
        :placeholder="t('adminFinance.searchPlaceholder')"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        class="afr__search"
        @click:clear="search = ''"
      />
      <v-chip-group v-model="types" multiple selected-class="text-primary" column>
        <v-chip v-for="ty in TYPES" :key="ty" :value="ty" filter size="small" variant="outlined">
          {{ t(`adminFinance.txnTypePlural.${ty}`) }}
        </v-chip>
      </v-chip-group>
      <div class="afr__row">
        <v-select
          :model-value="f.status"
          :items="STATUSES"
          :label="t('adminFinance.colStatus')"
          density="compact"
          variant="outlined"
          hide-details
          class="afr__sel"
          @update:model-value="finance.setRevenueFilter('status', $event)"
        />
        <v-text-field
          v-model="minAmount"
          :label="t('adminFinance.amountMin')"
          type="number"
          min="0"
          suffix="€"
          density="compact"
          variant="outlined"
          hide-details
          class="afr__amt"
        />
        <v-text-field
          v-model="maxAmount"
          :label="t('adminFinance.amountMax')"
          type="number"
          min="0"
          suffix="€"
          density="compact"
          variant="outlined"
          hide-details
          class="afr__amt"
        />
        <v-select
          :model-value="f.sort"
          :items="SORTS"
          :label="t('adminFinance.sortBy')"
          density="compact"
          variant="outlined"
          hide-details
          class="afr__sel"
          @update:model-value="finance.setRevenueFilter('sort', $event)"
        />
        <v-btn v-if="filtersActive" variant="text" size="small" prepend-icon="mdi-filter-remove-outline" @click="resetFilters">
          {{ t('adminFinance.resetFilters') }}
        </v-btn>
      </div>
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

    <div v-else class="rtable" :class="{ 'is-loading': finance.loadingRevenue }">
      <div class="rtable__head" aria-hidden="true">
        <span>{{ t('adminFinance.colDate') }}</span>
        <span>{{ t('adminFinance.colType') }}</span>
        <span>{{ t('adminFinance.colClient') }}</span>
        <span>{{ t('adminFinance.colBusiness') }}</span>
        <span>{{ t('adminFinance.colReference') }}</span>
        <span class="num">{{ t('adminFinance.colCredits') }}</span>
        <span class="num">{{ t('adminFinance.colMoney') }}</span>
        <span class="num">{{ t('adminFinance.vatColVat') }}</span>
      </div>

      <ul class="afr__list">
        <li v-for="r in finance.revenue" :key="r.id" class="rrow">
          <span class="rrow__cell rrow__date" :data-label="t('adminFinance.colDate')">
            {{ dt(r.createdAt) }} <small>{{ time(r.createdAt) }}</small>
          </span>
          <span class="rrow__cell" :data-label="t('adminFinance.colType')">
            <span class="chip" :class="typeClass(r.type)">{{ typeLabel(r) }}</span>
            <span v-if="r.status !== 'completed'" class="chip chip--muted">{{ t(`adminFinance.status.${r.status}`) }}</span>
          </span>
          <span class="rrow__person">
            <RouterLink v-if="r.userId" :to="{ name: 'admin-user', params: { id: r.userId } }" class="rrow__name">
              {{ r.userName ?? r.userEmail ?? '—' }}
            </RouterLink>
            <span v-else class="rrow__name">—</span>
            <span class="rrow__email">{{ r.userEmail }}</span>
          </span>
          <span class="rrow__cell rrow__trunc" :data-label="t('adminFinance.colBusiness')">
            {{ r.companyName ?? '—' }}
            <small v-if="r.clickCount" class="rrow__muted">· {{ t('adminFinance.clicks', { n: r.clickCount }) }}</small>
          </span>
          <span class="rrow__cell rrow__ref" :data-label="t('adminFinance.colReference')">
            <b v-if="r.invoiceNumber">{{ r.invoiceNumber }}</b>
            <small v-if="r.providerRef" :title="r.providerRef">{{ r.providerRef }}</small>
            <small v-if="!r.invoiceNumber && !r.providerRef && r.description" :title="r.description">{{ r.description }}</small>
          </span>
          <span class="rrow__cell rrow__face num" :data-label="t('adminFinance.colCredits')">
            {{ eur(r.amountMinor) }}
          </span>
          <span class="rrow__cell num" :data-label="t('adminFinance.colMoney')">
            <b>{{ r.moneyMinor ? eur(r.moneyMinor) : '—' }}</b>
          </span>
          <span class="rrow__cell rrow__face num" :data-label="t('adminFinance.vatColVat')">
            {{ r.vatMinor === null ? '—' : eur(r.vatMinor) }}
          </span>
        </li>
      </ul>

      <!-- Totals of the FULL filtered set (not this page), computed server-side. -->
      <div class="rtable__foot">
        <span class="rtable__footlabel">
          <span class="rtable__footlabelRow">
            {{ t('adminFinance.periodTotalLabel') }}
            <AdminHint
              v-if="discountDeltaMinor !== 0"
              :text="t('adminFinance.discountDeltaHint', { amount: eur(discountDeltaMinor) })"
            />
          </span>
          <small>{{ t('adminFinance.periodTotalTxnCount', { n: finance.revenueTotal }) }}</small>
        </span>
        <span class="rtable__footvals">
          <span class="rtable__footval rtable__footval--muted">
            <small>{{ t('adminFinance.colCredits') }}</small>
            {{ eur(finance.revenuePeriodFaceTotalMinor) }}
          </span>
          <span class="rtable__footval">
            <small>{{ t('adminFinance.colMoney') }}</small>
            <b>{{ eur(finance.revenuePeriodTotalMinor) }}</b>
          </span>
        </span>
      </div>
    </div>

    <AdminPager
      :page="f.page"
      :page-size="f.pageSize"
      :total="finance.revenueTotal"
      @update:page="finance.setRevenueFilter('page', $event)"
    />
  </div>
</template>

<style scoped>
.afr {
  max-width: 1180px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.afr__kpis {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.7rem;
}
.afr__subtotals {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.2rem;
  margin: 0.9rem 0 0;
  font-size: 0.82rem;
}
.afr__subtotal {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-variant-numeric: tabular-nums;
}
.afr__filters {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin: 1.2rem 0 1.2rem;
  padding: 0.9rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
}
.afr__search {
  max-width: 520px;
}
.afr__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}
.afr__sel {
  flex: 0 1 190px;
}
.afr__amt {
  flex: 0 1 130px;
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
  transition: opacity 0.15s ease;
}
.rtable.is-loading {
  opacity: 0.6;
}
.rtable__head,
.rrow {
  display: grid;
  grid-template-columns:
    minmax(0, 0.75fr) minmax(0, 0.95fr) minmax(0, 1.2fr) minmax(0, 0.9fr)
    minmax(0, 1fr) minmax(0, 0.65fr) minmax(0, 0.7fr) minmax(0, 0.55fr);
  align-items: center;
  gap: 0.8rem;
}
.num {
  text-align: right;
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
  padding: 0.75rem 1.1rem;
  border-bottom: 1px solid var(--tvz-hairline);
  background: rgb(var(--v-theme-surface));
}
.rrow:last-child {
  border-bottom: none;
}
.rrow__cell {
  font-size: 0.84rem;
  color: rgba(var(--v-theme-on-surface), 0.8);
  min-width: 0;
}
.rrow__cell b {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.rrow__date small,
.rrow__muted {
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 0.72rem;
}
.rrow__trunc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rrow__ref {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.rrow__ref small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, monospace;
  font-size: 0.7rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
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
  color: inherit;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
a.rrow__name:hover {
  color: rgb(var(--v-theme-primary));
}
.rrow__email {
  font-size: 0.74rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip {
  display: inline-block;
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.12rem 0.4rem;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  margin: 0.1rem 0.25rem 0.1rem 0;
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
.chip--muted {
  background: rgba(var(--v-theme-error), 0.12);
  color: rgb(var(--v-theme-error));
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
.rtable__footlabelRow {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
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

@media (max-width: 960px) {
  .rtable__head {
    display: none;
  }
  .rrow {
    grid-template-columns: 1fr 1fr;
    row-gap: 0.4rem;
  }
  .num {
    text-align: left;
  }
  /* Stacked rows lose the header, so each cell names itself. */
  .rrow__cell[data-label]::before {
    content: attr(data-label) ': ';
    color: rgba(var(--v-theme-on-surface), 0.45);
    font-size: 0.72rem;
  }
  .rrow__person,
  .rrow__ref {
    grid-column: span 2;
  }
  .rtable__footvals {
    gap: 1rem;
  }
}
@media (max-width: 600px) {
  .afr__kpis {
    grid-template-columns: 1fr;
  }
  .afr__sel,
  .afr__amt {
    flex: 1 1 140px;
  }
}
</style>
