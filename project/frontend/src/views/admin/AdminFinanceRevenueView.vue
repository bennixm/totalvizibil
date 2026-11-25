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
const TYPE_ICON: Record<RevenueTxnType, string> = {
  purchase: 'mdi-cash-plus',
  refund: 'mdi-cash-refund',
  adjustment: 'mdi-tune-variant',
  spend: 'mdi-cash-minus',
}
/** The last type on cannot be turned off: an empty register helps nobody. */
function toggleType(ty: RevenueTxnType): void {
  const on = types.value.includes(ty)
  if (on && types.value.length === 1) return
  types.value = on ? types.value.filter((x) => x !== ty) : TYPES.filter((x) => x === ty || types.value.includes(x))
}
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

    <!-- What the list shows: one clear switch per type, with its own subtotal. -->
    <fieldset class="afr__types">
      <legend>{{ t('adminFinance.showTypes') }}</legend>
      <button
        v-for="ty in TYPES"
        :key="ty"
        type="button"
        class="tsw"
        :class="[`tsw--${ty}`, { 'is-on': types.includes(ty) }]"
        role="switch"
        :aria-checked="types.includes(ty)"
        @click="toggleType(ty)"
      >
        <span class="tsw__top">
          <v-icon :icon="TYPE_ICON[ty]" size="18" class="tsw__icon" />
          <span class="tsw__name">{{ t(`adminFinance.txnTypePlural.${ty}`) }}</span>
          <v-icon :icon="types.includes(ty) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'" size="20" class="tsw__check" />
        </span>
        <span class="tsw__sum">
          <template v-if="types.includes(ty) && finance.revenueByType">
            <b>{{ eur(ty === 'purchase' || ty === 'refund' ? finance.revenueByType[ty].moneyMinor : finance.revenueByType[ty].amountMinor) }}</b>
            <small>{{ t('adminFinance.periodTotalTxnCount', { n: finance.revenueByType[ty].count }) }}</small>
          </template>
          <small v-else>{{ t('adminFinance.typeHidden') }}</small>
        </span>
      </button>
    </fieldset>

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
          class="afr__sel afr__sel--sort"
          @update:model-value="finance.setRevenueFilter('sort', $event)"
        />
        <v-btn v-if="filtersActive" class="afr__reset" variant="text" size="small" prepend-icon="mdi-filter-remove-outline" @click="resetFilters">
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
          <span class="rrow__cell rrow__trunc" :title="r.companyName ?? undefined" :data-label="t('adminFinance.colBusiness')">
            {{ r.companyName ?? '—' }}
            <small v-if="r.clickCount" class="rrow__muted rrow__clicks">{{ t('adminFinance.clicks', { n: r.clickCount }) }}</small>
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
.afr__types {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr));
  gap: 0.6rem;
  margin: 1.1rem 0 0;
  padding: 0;
  border: 0;
  min-width: 0;
}
.afr__types legend {
  margin-bottom: 0.5rem;
  padding: 0;
  font-size: var(--tvz-fs-small);
  font-weight: 600;
}
.tsw {
  --tc: var(--v-theme-primary);
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
  padding: 0.75rem 0.85rem;
  border: 1.5px solid rgba(var(--v-theme-on-surface), 0.16);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}
.tsw--purchase {
  --tc: var(--v-theme-success);
}
.tsw--refund {
  --tc: var(--v-theme-warning);
}
.tsw--adjustment {
  --tc: var(--v-theme-info);
}
.tsw:hover,
.tsw:focus-visible {
  border-color: rgba(var(--tc), 0.7);
}
.tsw.is-on {
  border-color: rgb(var(--tc));
  background: rgba(var(--tc), 0.1);
}
.tsw:not(.is-on) .tsw__name,
.tsw:not(.is-on) .tsw__sum {
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.tsw__top {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}
.tsw__icon,
.tsw__check {
  flex: none;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.is-on .tsw__icon,
.is-on .tsw__check {
  color: rgb(var(--tc));
}
.tsw__name {
  flex: 1;
  min-width: 0;
  font-size: var(--tvz-fs-body);
  font-weight: 600;
  overflow-wrap: anywhere;
}
.tsw__sum {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 0.5rem;
  min-height: 1.5rem;
  font-variant-numeric: tabular-nums;
}
.tsw__sum small {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.afr__filters {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin: 1.2rem 0 1.2rem;
  padding: 0.9rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  container-type: inline-size;
}
.afr__row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.6rem;
}
.afr__reset {
  grid-column: 1 / -1;
  justify-self: start;
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
  container-type: inline-size;
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
  /* Dates, types and sums keep the room their text needs; the names share
     the rest and are cut with an ellipsis, so cells can never overlap. */
  grid-template-columns:
    5.2rem 6.6rem minmax(0, 1.25fr) minmax(0, 0.9fr) minmax(0, 1fr)
    6rem 5.8rem 4.6rem;
  align-items: center;
  gap: 0.6rem;
}
.num {
  text-align: right;
  overflow-wrap: anywhere;
}
.rtable__head {
  padding: 0.65rem 0.9rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.45);
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-bottom: 1px solid var(--tvz-hairline);
}
.rrow {
  padding: 0.75rem 0.9rem;
  border-bottom: 1px solid var(--tvz-hairline);
  background: rgb(var(--v-theme-surface));
}
.rrow:last-child {
  border-bottom: none;
}
.rrow__cell {
  overflow: hidden;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.8);
  min-width: 0;
}
.rrow__cell b {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.rrow__date small {
  display: block;
}
.rrow__date small,
.rrow__muted {
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: var(--tvz-fs-caption);
}
.rrow__clicks {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
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
  font-size: var(--tvz-fs-micro);
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
  font-size: var(--tvz-fs-body);
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
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip {
  display: inline-block;
  max-width: 100%;
  line-height: 1.35;
  overflow-wrap: anywhere;
  font-size: var(--tvz-fs-micro);
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
  font-size: var(--tvz-fs-micro);
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
  font-size: var(--tvz-fs-micro);
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
  font-size: var(--tvz-fs-lead);
}
.rtable__footval small {
  font-family: inherit;
  font-size: var(--tvz-fs-micro);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.rtable__footval--muted {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: var(--tvz-fs-body);
}

@container (max-width: 800px) {
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
    font-size: var(--tvz-fs-caption);
  }
  .rrow__cell {
    overflow-wrap: anywhere;
  }
  .rrow__trunc {
    white-space: normal;
  }
  .rrow__date small {
    display: inline;
  }
  .rrow__person,
  .rrow__ref {
    grid-column: span 2;
  }
  .rrow__ref:empty {
    display: none;
  }
  .rtable__footvals {
    gap: 1rem;
  }
}
@media (max-width: 600px) {
  .afr__kpis {
    grid-template-columns: 1fr;
  }
}
/* Narrow filter box: search full width, then the four fields as two even
   pairs, the two dropdowns together (status | sort) and the two amounts
   together (min | max), instead of whatever the wrap happened to pair. */
@container (max-width: 560px) {
  .afr__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0.6rem;
  }
  .afr__sel {
    order: 1;
  }
  .afr__amt {
    order: 2;
  }
  .afr__reset {
    order: 3;
  }
}
</style>
