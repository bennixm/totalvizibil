<script setup lang="ts">
/**
 * Facturi furnizori: the original invoices our own providers bill us with,
 * collected in one place for the company's accounting, with payment and
 * due-date tracking. Imported from official provider APIs where they exist,
 * uploaded (optionally AI-prefilled, always human-confirmed) for the rest.
 *
 * Layout: KPI summary → collection sources (collapsible) → period → filters
 * → table (sortable, multi-select, bulk actions) → detail panel.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminPager from '@/components/admin/AdminPager.vue'
import AdminPeriodFilter from '@/components/admin/AdminPeriodFilter.vue'
import InvoiceBadge from '@/components/admin/supplier-invoices/InvoiceBadge.vue'
import SupplierInvoiceDrawer from '@/components/admin/supplier-invoices/SupplierInvoiceDrawer.vue'
import SupplierInvoiceSources from '@/components/admin/supplier-invoices/SupplierInvoiceSources.vue'
import SupplierInvoiceSummary from '@/components/admin/supplier-invoices/SupplierInvoiceSummary.vue'
import SupplierInvoiceUploadDialog from '@/components/admin/supplier-invoices/SupplierInvoiceUploadDialog.vue'
import SupplierRegistryPanel from '@/components/admin/supplier-invoices/SupplierRegistryPanel.vue'
import DueCalendar from '@/components/admin/supplier-invoices/DueCalendar.vue'
import VatReportPanel from '@/components/admin/supplier-invoices/VatReportPanel.vue'
import InvoiceInsights from '@/components/admin/supplier-invoices/InvoiceInsights.vue'
import { useInvoiceFormat } from '@/components/admin/supplier-invoices/useInvoiceFormat'
import { usePeriodFilter } from '@/composables/usePeriodFilter'
import { useConfirmStore } from '@/stores/confirm'
import {
  useExternalInvoicesStore,
  type BulkAction,
  type ExternalInvoice,
  type ExternalInvoiceProviderKey,
  type SortField,
} from '@/stores/externalInvoices'
import { useMoneyStore } from '@/stores/money'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const store = useExternalInvoicesStore()
const confirm = useConfirmStore()
const toasts = useToastStore()
const fmt = useInvoiceFormat()
const f = store.filters

// --- period (shared finance-page component) -----------------------------------
const { activePreset, customFrom, customTo, canApplyCustom, setQuickRange, applyCustomRange, pickMonth, pickYear } =
  usePeriodFilter((from, to) => store.setPeriod(from, to))
const activeRangeLabel = computed(() => {
  if (!f.from && !f.to) return t('adminFinance.lifetime')
  return `${f.from ? fmt.date(f.from) : '…'} - ${f.to ? fmt.date(f.to) : '…'}`
})

// --- filters ------------------------------------------------------------------
const supplierFilterName = ref<string | null>(null)
const search = ref(f.q)
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (v) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => store.setFilter('q', v ?? ''), 300)
})
const PROVIDER_ITEMS = computed(() =>
  store.providers.map((p) => ({ value: p.key, title: p.key === 'other' ? t('supplierInvoices.providerOther') : p.name })),
)
const PAYMENT_ITEMS = computed(() => [
  { value: 'unpaid', title: t('supplierInvoices.statusUnpaid') },
  { value: 'paid', title: t('supplierInvoices.statusPaid') },
  { value: 'unknown', title: t('supplierInvoices.statusUnknown') },
])
const DUE_ITEMS = computed(() => [
  { value: 'overdue', title: t('supplierInvoices.filterOverdue') },
  { value: 'due_soon', title: t('supplierInvoices.filterDueSoon') },
])
const PROC_ITEMS = computed(() => [
  { value: 'needs_review', title: t('supplierInvoices.procReview') },
  { value: 'verified', title: t('supplierInvoices.procVerified') },
])
const SOURCE_ITEMS = computed(() =>
  (['api', 'manual'] as const).map((s) => ({ value: s, title: fmt.sourceLabel(s) })),
)
function resetFilters(): void {
  search.value = ''
  supplierFilterName.value = null
  store.resetFilters()
}

// --- compact toolbar: period and filters live in menus -------------------------
const periodOpen = ref(false)
const filtersOpen = ref(false)
const sourcesOpen = ref(false)
/** Active narrowing filters as closable chips (the "active filters"
 *  indicator); period and sort are not filters here. */
const filterChips = computed(() => {
  const out: { key: string; label: string; clear: () => void }[] = []
  const item = (list: { value: string; title: string }[], v: string | null) => list.find((x) => x.value === v)?.title ?? v ?? ''
  if (f.q.trim()) out.push({ key: 'q', label: `"${f.q.trim()}"`, clear: () => { search.value = '' } })
  if (f.supplierId) {
    out.push({ key: 'supplier', label: supplierFilterName.value ?? t('supplierInvoices.oneSupplier'), clear: clearSupplier })
  }
  if (f.provider) out.push({ key: 'provider', label: item(PROVIDER_ITEMS.value, f.provider), clear: () => store.setFilter('provider', null) })
  if (f.payment) out.push({ key: 'payment', label: item(PAYMENT_ITEMS.value, f.payment), clear: () => store.setFilter('payment', null) })
  if (f.due) out.push({ key: 'due', label: item(DUE_ITEMS.value, f.due), clear: () => store.setFilter('due', null) })
  if (f.processing) out.push({ key: 'processing', label: item(PROC_ITEMS.value, f.processing), clear: () => store.setFilter('processing', null) })
  if (f.source) out.push({ key: 'source', label: item(SOURCE_ITEMS.value, f.source), clear: () => store.setFilter('source', null) })
  return out
})
/** A dot on "Sources" when an automatic import needs attention. */
const sourcesWarning = computed(() =>
  store.providers.some((p) => p.automated && (p.configured === false || (p.lastSync && !p.lastSync.ok))),
)

// --- rows grouped by month when sorted by date -----------------------------------
type ListEntry = { kind: 'month'; key: string; label: string } | { kind: 'row'; key: string; row: ExternalInvoice }
const entries = computed<ListEntry[]>(() => {
  const byDate = f.sortField === 'issueDate'
  const out: ListEntry[] = []
  let last = ''
  for (const r of store.items) {
    if (byDate) {
      const ym = String(r.issueDate).slice(0, 7)
      if (ym !== last) {
        last = ym
        out.push({ kind: 'month', key: `m-${ym}`, label: fmt.monthName(Number(ym.slice(5, 7)), Number(ym.slice(0, 4))) })
      }
    }
    out.push({ kind: 'row', key: r.id, row: r })
  }
  return out
})

/** One-click payment change from the row menu (same API as the panel). */
async function quick(r: ExternalInvoice, patch: Record<string, unknown>, msg: string): Promise<void> {
  try {
    await store.update(r.id, patch)
    toasts.success(msg)
  } catch (e) {
    toasts.error(fmt.errText(e))
  }
}

/** Which KPI card mirrors the current filters (highlighted). */
const activeKpi = computed(() => {
  if (f.due === 'overdue') return 'overdue'
  if (f.due === 'due_soon') return 'due_soon'
  if (f.processing === 'needs_review') return 'needs_review'
  if (f.payment === 'unpaid') return 'unpaid'
  return null
})
function pickKpi(key: 'month' | 'unpaid' | 'due_soon' | 'overdue' | 'needs_review'): void {
  const clear = { due: null, processing: null, payment: null } as const
  if (key === 'month') {
    setQuickRange('month')
    return
  }
  if (activeKpi.value === key) {
    store.applyFilters({ ...clear })
    return
  }
  if (key === 'unpaid') store.applyFilters({ ...clear, payment: 'unpaid' })
  if (key === 'due_soon') store.applyFilters({ ...clear, due: 'due_soon' })
  if (key === 'overdue') store.applyFilters({ ...clear, due: 'overdue' })
  if (key === 'needs_review') store.applyFilters({ ...clear, processing: 'needs_review' })
  if (activePreset.value !== 'lifetime') setQuickRange('lifetime')
}

// --- sorting --------------------------------------------------------------------
function sortIcon(field: SortField): string {
  if (f.sortField !== field) return 'mdi-swap-vertical'
  return f.sortDir === 'asc' ? 'mdi-arrow-up' : 'mdi-arrow-down'
}
function ariaSort(field: SortField): 'ascending' | 'descending' | 'none' {
  if (f.sortField !== field) return 'none'
  return f.sortDir === 'asc' ? 'ascending' : 'descending'
}

// --- selection + bulk -------------------------------------------------------------
const selected = ref<Set<string>>(new Set())
const allOnPage = computed(() => store.items.length > 0 && store.items.every((r) => selected.value.has(r.id)))
const someOnPage = computed(() => !allOnPage.value && store.items.some((r) => selected.value.has(r.id)))
function toggle(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}
function toggleAll(): void {
  const next = new Set(selected.value)
  if (allOnPage.value) store.items.forEach((r) => next.delete(r.id))
  else store.items.forEach((r) => next.add(r.id))
  selected.value = next
}
const bulkBusy = ref<string | null>(null)
function bulk(action: BulkAction): void {
  const ids = [...selected.value]
  const run = async () => {
    bulkBusy.value = action
    try {
      const r = await store.bulk(ids, action)
      toasts.success(t('supplierInvoices.bulkDone', { n: r.changed }))
    } catch (e) {
      toasts.error(fmt.errText(e))
    } finally {
      bulkBusy.value = null
    }
  }
  confirm.ask(
    t('supplierInvoices.bulkConfirmTitle'),
    t(`supplierInvoices.bulkConfirm.${action}`, { n: ids.length }),
    run,
  )
}

// --- ZIP ------------------------------------------------------------------------
const zipBusy = ref<string | null>(null)
async function zip(scope: { ids?: string[]; all?: boolean; filters?: boolean }, tag: string): Promise<void> {
  zipBusy.value = tag
  try {
    await store.downloadZip(scope)
  } catch (e) {
    toasts.error(fmt.errText(e))
  } finally {
    zipBusy.value = null
  }
}

// --- sync / upload / detail ---------------------------------------------------------
const syncBusy = ref(false)
async function syncGoogle(): Promise<void> {
  syncBusy.value = true
  try {
    const r = await store.sync('google_ads')
    if (r.ok) {
      toasts.success(t('supplierInvoices.syncDone', { imported: r.imported, updated: r.updated, documents: r.documents }))
    } else toasts.error(fmt.reason(r.message) || t('admin.genericError'))
  } catch (e) {
    toasts.error(fmt.errText(e))
  } finally {
    syncBusy.value = false
  }
}

const uploadOpen = ref(false)
const uploadProvider = ref<ExternalInvoiceProviderKey | null>(null)
function openUpload(p?: ExternalInvoiceProviderKey): void {
  uploadProvider.value = p ?? null
  uploadOpen.value = true
}

/** The open invoice lives in the URL (?invoice=…) so it survives a reload
 *  and a notification can deep-link to it. */
const openId = computed(() => (typeof route.query.invoice === 'string' ? route.query.invoice : null))
function openInvoice(id: string | null): void {
  const query = { ...route.query }
  if (id) query.invoice = id
  else delete query.invoice
  void router.replace({ query })
}
function onRowKey(e: KeyboardEvent, r: ExternalInvoice): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    openInvoice(r.id)
  }
}

// A notification clicked while already on this page only changes the query.
watch(
  () => route.query.due,
  (due) => {
    if ((due === 'overdue' || due === 'due_soon') && f.due !== due) store.applyFilters({ due })
  },
)

// --- page tabs (kept in the URL: ?tab=suppliers|calendar|vat) ------------------
type PageTab = 'invoices' | 'suppliers' | 'calendar' | 'vat'
const PAGE_TABS: PageTab[] = ['invoices', 'suppliers', 'calendar', 'vat']
const pageTab = computed<PageTab>({
  get: () => (PAGE_TABS.includes(route.query.tab as PageTab) ? (route.query.tab as PageTab) : 'invoices'),
  set: (v) => {
    const query = { ...route.query }
    if (v === 'invoices') delete query.tab
    else query.tab = v
    void router.replace({ query })
  },
})
function showSupplier(id: string): void {
  void store.fetchSuppliers().then((list) => {
    supplierFilterName.value = list.find((x) => x.id === id)?.name ?? null
  })
  store.applyFilters({ supplierId: id })
  pageTab.value = 'invoices'
}
function clearSupplier(): void {
  supplierFilterName.value = null
  store.setFilter('supplierId', null)
}

// Amounts follow the platform display currency (top-nav EUR/RON toggle):
// list items carry both conversions, aggregates are recomputed server-side.
const moneyStore = useMoneyStore()
watch(
  () => moneyStore.currency,
  () => {
    void store.loadSummary()
    void store.loadInsights()
    void store.load()
  },
)

const filtered = computed(() => store.activeFilterCount > 0 || !!f.from || !!f.to)

onMounted(() => {
  // Deep links from notifications: ?due=overdue|due_soon
  const due = route.query.due
  if (due === 'overdue' || due === 'due_soon') f.due = due
  // Default: every invoice (supplier invoices are reviewed across months).
  activePreset.value = 'lifetime'
  f.from = null
  f.to = null
  void store.refresh()
})
</script>

<template>
  <div class="asi">
    <!-- 1. Title + primary action; secondary actions grouped -->
    <AdminPageHeader
      class="asi__head"
      :title="t('supplierInvoices.title')"
      :eyebrow="t('admin.navGroupFinance')"
      :hint="t('supplierInvoices.sub')"
    >
      <template #actions>
        <v-btn variant="text" size="small" prepend-icon="mdi-source-branch" class="hd-btn" @click="sourcesOpen = true">
          {{ t('supplierInvoices.providersTitle') }}
          <span v-if="sourcesWarning" class="hd-dot" :title="t('supplierInvoices.sourcesWarning')" />
        </v-btn>
        <v-menu v-if="pageTab === 'invoices'" location="bottom end">
          <template #activator="{ props: menu }">
            <v-btn
              v-bind="menu"
              variant="tonal"
              size="small"
              prepend-icon="mdi-tray-arrow-down"
              append-icon="mdi-chevron-down"
              :loading="!!zipBusy"
            >
              {{ t('supplierInvoices.exportMenu') }}
            </v-btn>
          </template>
          <v-list density="compact" min-width="250">
            <v-list-subheader>{{ t('supplierInvoices.exportData') }}</v-list-subheader>
            <v-list-item prepend-icon="mdi-microsoft-excel" :title="t('adminFinance.exportXlsx')" :href="store.exportUrl('xlsx')" :disabled="!store.total" />
            <v-list-item prepend-icon="mdi-file-delimited-outline" :title="t('adminFinance.exportCsv')" :href="store.exportUrl('csv')" :disabled="!store.total" />
            <v-divider class="my-1" />
            <v-list-subheader>{{ t('supplierInvoices.exportDocuments') }}</v-list-subheader>
            <v-list-item
              prepend-icon="mdi-filter-outline"
              :title="t('supplierInvoices.zipFiltered')"
              :subtitle="t('supplierInvoices.zipFilteredSub', { n: store.total })"
              :disabled="!store.total"
              @click="zip({ filters: true }, 'filters')"
            />
            <v-list-item prepend-icon="mdi-folder-zip-outline" :title="t('supplierInvoices.downloadAll')" @click="zip({ all: true }, 'all')" />
          </v-list>
        </v-menu>
        <v-btn color="primary" variant="flat" size="small" prepend-icon="mdi-plus" @click="openUpload()">
          {{ t('supplierInvoices.addInvoice') }}
        </v-btn>
      </template>
    </AdminPageHeader>

    <v-tabs v-model="pageTab" density="compact" color="primary" class="asi__tabs" show-arrows>
      <v-tab value="invoices">{{ t('supplierInvoices.tabInvoices') }}</v-tab>
      <v-tab value="suppliers">{{ t('supplierInvoices.tabSuppliers') }}</v-tab>
      <v-tab value="calendar">{{ t('supplierInvoices.tabCalendar') }}</v-tab>
      <v-tab value="vat">{{ t('supplierInvoices.tabVat') }}</v-tab>
    </v-tabs>

    <SupplierRegistryPanel v-if="pageTab === 'suppliers'" @show-invoices="showSupplier" />
    <DueCalendar v-else-if="pageTab === 'calendar'" @open="openInvoice" />
    <VatReportPanel v-else-if="pageTab === 'vat'" />

    <template v-else>
      <!-- 2. Essentials -->
      <SupplierInvoiceSummary :summary="store.summary" :error="store.summaryError" :active="activeKpi" @pick="pickKpi" />
      <InvoiceInsights :insights="store.insights" @open="openInvoice" @supplier="showSupplier" />

      <!-- 3. Main content -->
      <section class="asi__list">
        <div class="tb" role="search">
          <v-text-field
            v-model="search"
            prepend-inner-icon="mdi-magnify"
            :placeholder="t('supplierInvoices.searchPlaceholder')"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            class="tb__search"
            @click:clear="search = ''"
          />

          <v-menu v-model="periodOpen" :close-on-content-click="false" location="bottom end" max-width="640">
            <template #activator="{ props: menu }">
              <v-btn v-bind="menu" variant="outlined" class="tb__btn" prepend-icon="mdi-calendar-range" append-icon="mdi-chevron-down">
                <span class="tb__btnlabel">{{ activeRangeLabel }}</span>
              </v-btn>
            </template>
            <v-card class="tb__panel tb__periodcard" rounded="lg">
              <AdminPeriodFilter
                v-model:custom-from="customFrom"
                v-model:custom-to="customTo"
                :preset="activePreset"
                :can-apply-custom="canApplyCustom"
                :active-range-label="activeRangeLabel"
                calendar-pickers
                class="tb__period"
                @preset="(p) => { setQuickRange(p); periodOpen = false }"
                @apply="() => { applyCustomRange(); periodOpen = false }"
                @pick-month="(m) => { pickMonth(m); periodOpen = false }"
                @pick-year="(y) => { pickYear(y); periodOpen = false }"
              />
            </v-card>
          </v-menu>

          <v-menu v-model="filtersOpen" :close-on-content-click="false" location="bottom end">
            <template #activator="{ props: menu }">
              <v-btn
                v-bind="menu"
                variant="outlined"
                class="tb__btn"
                prepend-icon="mdi-tune-variant"
                :color="filterChips.length ? 'primary' : undefined"
              >
                {{ t('supplierInvoices.filters') }}
                <span v-if="filterChips.length" class="tb__count">{{ filterChips.length }}</span>
              </v-btn>
            </template>
            <v-card class="tb__panel tb__filters" rounded="lg">
              <v-select :model-value="f.provider" :items="PROVIDER_ITEMS" :label="t('supplierInvoices.colProvider')" density="compact" variant="outlined" hide-details clearable @update:model-value="store.setFilter('provider', $event ?? null)" />
              <v-select :model-value="f.payment" :items="PAYMENT_ITEMS" :label="t('supplierInvoices.colPayment')" density="compact" variant="outlined" hide-details clearable @update:model-value="store.setFilter('payment', $event ?? null)" />
              <v-select :model-value="f.due" :items="DUE_ITEMS" :label="t('supplierInvoices.colDue')" density="compact" variant="outlined" hide-details clearable @update:model-value="store.setFilter('due', $event ?? null)" />
              <v-select :model-value="f.processing" :items="PROC_ITEMS" :label="t('supplierInvoices.colProcessing')" density="compact" variant="outlined" hide-details clearable @update:model-value="store.setFilter('processing', $event ?? null)" />
              <v-select :model-value="f.source" :items="SOURCE_ITEMS" :label="t('supplierInvoices.colSource')" density="compact" variant="outlined" hide-details clearable @update:model-value="store.setFilter('source', $event ?? null)" />
              <div class="tb__filters-foot">
                <v-btn variant="text" size="small" :disabled="!filterChips.length" @click="resetFilters">{{ t('supplierInvoices.resetFilters') }}</v-btn>
                <v-btn variant="tonal" size="small" color="primary" @click="filtersOpen = false">{{ t('supplierInvoices.done') }}</v-btn>
              </div>
            </v-card>
          </v-menu>
        </div>

        <!-- Result line: active filters, count, totals -->
        <div class="res">
          <div class="res__chips">
            <span class="res__count">{{ t('supplierInvoices.resultCount', { n: store.total }) }}</span>
            <v-chip v-for="c in filterChips" :key="c.key" size="small" variant="tonal" closable @click:close="c.clear">
              {{ c.label }}
            </v-chip>
            <button v-if="filterChips.length > 1" type="button" class="res__reset" @click="resetFilters">
              {{ t('supplierInvoices.resetFilters') }}
            </button>
          </div>
          <span v-for="tot in store.totalsByCurrency" :key="tot.currency" class="res__tot">
            <b>{{ fmt.amount(tot.totalMinor, tot.currency) }}</b>
            <small v-if="tot.taxMinor">{{ t('supplierInvoices.vatIncluded', { amount: fmt.amount(tot.taxMinor, tot.currency) }) }}</small>
          </span>
        </div>

        <!-- Bulk bar (only with a selection) -->
        <div v-if="selected.size" class="bulk" role="region" :aria-label="t('supplierInvoices.bulkLabel')">
          <span class="bulk__n">{{ t('supplierInvoices.selectedCount', { n: selected.size }) }}</span>
          <v-menu location="bottom start">
            <template #activator="{ props: menu }">
              <v-btn v-bind="menu" size="small" variant="tonal" color="primary" append-icon="mdi-chevron-down" :loading="!!bulkBusy">
                {{ t('supplierInvoices.markAs') }}
              </v-btn>
            </template>
            <v-list density="compact">
              <v-list-item prepend-icon="mdi-cash-check" :title="t('supplierInvoices.markPaid')" @click="bulk('mark_paid')" />
              <v-list-item prepend-icon="mdi-cash-remove" :title="t('supplierInvoices.markUnpaid')" @click="bulk('mark_unpaid')" />
              <v-list-item prepend-icon="mdi-shield-check-outline" :title="t('supplierInvoices.markVerified')" @click="bulk('mark_verified')" />
            </v-list>
          </v-menu>
          <v-btn size="small" variant="text" prepend-icon="mdi-folder-zip-outline" :loading="zipBusy === 'sel'" @click="zip({ ids: [...selected] }, 'sel')">
            {{ t('supplierInvoices.zip') }}
          </v-btn>
          <v-btn size="small" variant="text" icon="mdi-close" class="bulk__clear" :aria-label="t('supplierInvoices.clearSelection')" :title="t('supplierInvoices.clearSelection')" @click="selected = new Set()" />
        </div>

        <div v-if="store.loading && !store.loaded" class="tbl tbl--skel">
          <v-skeleton-loader type="table-thead, table-row-divider@6" />
        </div>
        <div v-else-if="store.error" class="state">
          <v-icon icon="mdi-alert-circle-outline" size="26" />
          <p>{{ store.error }}</p>
          <v-btn variant="tonal" size="small" @click="store.load()">{{ t('common.retry') }}</v-btn>
        </div>
        <div v-else-if="!store.items.length" class="state">
          <v-icon :icon="filtered ? 'mdi-filter-off-outline' : 'mdi-file-document-multiple-outline'" size="28" />
          <p class="state__title">{{ filtered ? t('supplierInvoices.noMatches') : t('supplierInvoices.emptyTitle') }}</p>
          <p v-if="!filtered" class="state__text">{{ t('supplierInvoices.empty') }}</p>
          <div class="state__actions">
            <v-btn v-if="filtered" variant="tonal" size="small" @click="resetFilters(); setQuickRange('lifetime')">
              {{ t('supplierInvoices.resetFilters') }}
            </v-btn>
            <template v-else>
              <v-btn color="primary" variant="flat" size="small" prepend-icon="mdi-plus" @click="openUpload()">
                {{ t('supplierInvoices.addInvoice') }}
              </v-btn>
              <v-btn variant="text" size="small" @click="sourcesOpen = true">{{ t('supplierInvoices.providersTitle') }}</v-btn>
            </template>
          </div>
        </div>

        <div v-else class="tbl" :class="{ 'is-loading': store.loading }" role="table" :aria-label="t('supplierInvoices.title')">
          <div class="tbl__head" role="row">
            <span class="c-check" role="columnheader">
              <v-checkbox-btn color="primary" :model-value="allOnPage" :indeterminate="someOnPage" density="compact" :aria-label="t('supplierInvoices.selectPage')" @update:model-value="toggleAll" />
            </span>
            <button type="button" class="c-sup th" role="columnheader" :aria-sort="ariaSort('provider')" @click="store.toggleSort('provider')">
              {{ t('supplierInvoices.colProvider') }} <v-icon :icon="sortIcon('provider')" size="12" class="th__i" />
            </button>
            <button type="button" class="c-num th" role="columnheader" :aria-sort="ariaSort('invoiceNumber')" @click="store.toggleSort('invoiceNumber')">
              {{ t('supplierInvoices.colNumberShort') }} <v-icon :icon="sortIcon('invoiceNumber')" size="12" class="th__i" />
            </button>
            <button type="button" class="c-date th" role="columnheader" :aria-sort="ariaSort('issueDate')" @click="store.toggleSort('issueDate')">
              {{ t('supplierInvoices.colIssuedShort') }} <v-icon :icon="sortIcon('issueDate')" size="12" class="th__i" />
            </button>
            <button type="button" class="c-due th" role="columnheader" :aria-sort="ariaSort('dueDate')" @click="store.toggleSort('dueDate')">
              {{ t('supplierInvoices.colDue') }} <v-icon :icon="sortIcon('dueDate')" size="12" class="th__i" />
            </button>
            <span class="c-net th-r" role="columnheader">{{ t('supplierInvoices.colNet') }}</span>
            <span class="c-vat th-r" role="columnheader">{{ t('supplierInvoices.colVat') }}</span>
            <button type="button" class="c-total th th-r" role="columnheader" :aria-sort="ariaSort('totalMinor')" @click="store.toggleSort('totalMinor')">
              <v-icon :icon="sortIcon('totalMinor')" size="12" class="th__i" /> {{ t('supplierInvoices.colTotal') }}
            </button>
            <span class="c-status" role="columnheader">{{ t('supplierInvoices.colStatus') }}</span>
            <span class="c-act" role="columnheader"><span class="sr-only">{{ t('supplierInvoices.colActions') }}</span></span>
          </div>

          <template v-for="e in entries" :key="e.key">
            <div v-if="e.kind === 'month'" class="tgroup" role="row">
              <span role="cell">{{ e.label }}</span>
            </div>
            <div
              v-else
              class="tr"
              :class="{ 'is-selected': selected.has(e.row.id), 'is-open': openId === e.row.id }"
              role="row"
              tabindex="0"
              :aria-label="`${e.row.providerName} ${e.row.invoiceNumber ?? ''}`"
              @click="openInvoice(e.row.id)"
              @keydown="onRowKey($event, e.row)"
            >
              <span class="c-check" role="cell" @click.stop>
                <v-checkbox-btn color="primary" :model-value="selected.has(e.row.id)" density="compact" :aria-label="t('supplierInvoices.selectRow', { n: e.row.invoiceNumber ?? e.row.id })" @update:model-value="toggle(e.row.id)" />
              </span>
              <span class="c-sup" role="cell" :title="[e.row.providerName, e.row.supplierVatId, fmt.sourceLabel(e.row.source)].filter(Boolean).join(' · ')">
                <span class="ell strong">{{ e.row.providerName }}</span>
              </span>
              <span class="c-num" role="cell" :title="e.row.invoiceNumber ?? ''">
                <span class="ell mono">{{ e.row.invoiceNumber ?? '-' }}</span>
                <span v-if="e.row.docType && e.row.docType !== 'INVOICE'" class="mini">{{ e.row.docType }}</span>
              </span>
              <span class="c-date mono" role="cell" :data-label="t('supplierInvoices.colIssuedShort')">{{ fmt.date(e.row.issueDate) }}</span>
              <span class="c-due mono" role="cell" :data-label="t('supplierInvoices.colDue')" :class="e.row.dueState ? `due--${e.row.dueState}` : ''">
                {{ fmt.date(e.row.dueDate) }}
              </span>
              <span class="c-net num" role="cell">{{ fmt.dAmount(e.row.subtotalMinor, e.row) }}</span>
              <span class="c-vat num" role="cell">{{ fmt.dAmount(e.row.taxMinor, e.row) }}</span>
              <span class="c-total num strong" role="cell">{{ fmt.dAmount(e.row.totalMinor, e.row) }}</span>
              <span class="c-status" role="cell">
                <InvoiceBadge v-bind="fmt.payment(e.row)" />
                <v-icon
                  v-if="e.row.processingStatus === 'needs_review'"
                  :icon="fmt.processing(e.row).icon"
                  size="15"
                  :class="`flag--${fmt.processing(e.row).tone}`"
                  :title="fmt.processing(e.row).label"
                  :aria-label="fmt.processing(e.row).label"
                />
              </span>
              <span class="c-act" role="cell" @click.stop>
                <v-btn
                  v-if="e.row.document"
                  icon="mdi-file-eye-outline"
                  size="small"
                  variant="text"
                  density="comfortable"
                  :href="store.documentUrl(e.row.id, true)"
                  target="_blank"
                  rel="noopener"
                  :aria-label="t('supplierInvoices.open')"
                  :title="t('supplierInvoices.open')"
                />
                <span v-else class="nodoc" :title="e.row.documentError ? fmt.reason(e.row.documentError) : t('supplierInvoices.noDocument')">
                  <v-icon icon="mdi-file-alert-outline" size="17" />
                </span>
                <v-menu location="bottom end">
                  <template #activator="{ props: menu }">
                    <v-btn v-bind="menu" icon="mdi-dots-horizontal" size="small" variant="text" density="comfortable" :aria-label="t('supplierInvoices.colActions')" />
                  </template>
                  <v-list density="compact" min-width="220">
                    <v-list-item prepend-icon="mdi-text-box-search-outline" :title="t('supplierInvoices.details')" @click="openInvoice(e.row.id)" />
                    <v-list-item v-if="e.row.document" prepend-icon="mdi-download-outline" :title="t('supplierInvoices.download')" :href="store.documentUrl(e.row.id)" />
                    <v-divider class="my-1" />
                    <v-list-item v-if="e.row.paymentStatus !== 'paid'" prepend-icon="mdi-cash-check" :title="t('supplierInvoices.markPaid')" @click="quick(e.row, { paymentStatus: 'paid' }, t('supplierInvoices.markedPaid'))" />
                    <v-list-item v-else prepend-icon="mdi-cash-remove" :title="t('supplierInvoices.markUnpaid')" @click="quick(e.row, { paymentStatus: 'unpaid' }, t('supplierInvoices.markedUnpaid'))" />
                    <v-list-item
                      v-if="e.row.processingStatus === 'needs_review'"
                      prepend-icon="mdi-shield-check-outline"
                      :title="t('supplierInvoices.markVerified')"
                      @click="openInvoice(e.row.id)"
                    />
                  </v-list>
                </v-menu>
              </span>
            </div>
          </template>
        </div>

        <AdminPager :page="f.page" :page-size="f.pageSize" :total="store.total" @update:page="store.setFilter('page', $event)" />
      </section>
    </template>

    <!-- Collection sources (secondary): a dialog, not a block on the page -->
    <v-dialog v-model="sourcesOpen" max-width="760" scrollable>
      <v-card rounded="lg">
        <v-card-title class="d-flex align-center">
          {{ t('supplierInvoices.providersTitle') }}
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" size="small" :aria-label="t('common.close')" @click="sourcesOpen = false" />
        </v-card-title>
        <v-card-text class="pa-0">
          <SupplierInvoiceSources
            embedded
            :providers="store.providers"
            :error="store.providersError"
            :syncing="syncBusy"
            :active-provider="f.provider"
            @sync="syncGoogle"
            @upload="(p) => { sourcesOpen = false; openUpload(p) }"
            @filter="(p) => { sourcesOpen = false; pageTab = 'invoices'; store.setFilter('provider', p) }"
          />
        </v-card-text>
      </v-card>
    </v-dialog>

    <SupplierInvoiceUploadDialog v-model="uploadOpen" :provider="uploadProvider" @saved="openInvoice" />
    <SupplierInvoiceDrawer :invoice-id="openId" @close="openInvoice(null)" @open="openInvoice" />
  </div>
</template>

<style scoped>
.asi {
  /* One spacing scale for the whole module. */
  --s1: 0.5rem;
  --s2: 0.75rem;
  --s3: 1rem;
  --row-h: 2.9rem;
  display: flex;
  flex-direction: column;
  gap: var(--s3);
  max-width: 1180px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.asi .asi__head {
  margin: 0;
}
.asi__tabs {
  border-bottom: 1px solid var(--tvz-hairline);
}
@media (max-width: 600px) {
  .asi__tabs :deep(.v-tab) {
    padding-inline: 0.7rem;
    min-width: 0;
  }
}
.hd-btn {
  position: relative;
}
.hd-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgb(var(--v-theme-warning));
}
.asi__list {
  display: flex;
  flex-direction: column;
  gap: var(--s2);
  container-type: inline-size;
}

/* --- toolbar --------------------------------------------------------- */
.tb {
  display: flex;
  align-items: center;
  gap: var(--s1);
}
.tb__search {
  flex: 1 1 auto;
  min-width: 0;
}
.tb__btn {
  flex: 0 0 auto;
  height: 40px !important;
  max-width: 16rem;
  border-color: var(--tvz-glass-border) !important;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
}
.tb__btnlabel {
  overflow: hidden;
  text-overflow: ellipsis;
}
.tb__count {
  display: inline-grid;
  place-items: center;
  min-width: 1.2rem;
  height: 1.2rem;
  margin-left: 0.4rem;
  padding: 0 0.3rem;
  border-radius: 999px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
}
.tb__panel {
  /* Menus render in the overlay container, outside .asi: no --s* vars. */
  padding: 1rem;
}
.tb__periodcard {
  width: min(40rem, 92vw);
}
.tb__period {
  margin: 0;
  padding: 0;
  border: 0;
}
.tb__filters {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: min(20rem, 90vw);
}
.tb__filters-foot {
  display: flex;
  justify-content: space-between;
}

/* --- result line --------------------------------------------------------- */
.res {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--s1) var(--s3);
  min-height: 1.75rem;
}
.res__chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}
.res__count {
  margin-right: 0.25rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.res__reset {
  padding: 0;
  border: 0;
  background: none;
  color: rgb(var(--v-theme-primary));
  font: inherit;
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  cursor: pointer;
}
.res__tot {
  font-size: var(--tvz-fs-small);
  font-variant-numeric: tabular-nums;
}
.res__tot b {
  font-family: 'Space Grotesk Variable', sans-serif;
}
.res__tot small {
  margin-left: 0.35rem;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* --- bulk bar ------------------------------------------------------------ */
.bulk {
  position: sticky;
  top: 0.5rem;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: var(--s1);
  padding: 0.4rem 0.4rem 0.4rem 0.9rem;
  border: 1px solid rgba(var(--v-theme-primary), 0.4);
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.16);
}
.bulk__n {
  margin-right: auto;
  font-size: var(--tvz-fs-body);
  font-weight: 600;
}

/* --- states -------------------------------------------------------------- */
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  padding: 2.5rem 1rem;
  border: 1px dashed var(--tvz-glass-border);
  border-radius: 12px;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.state p {
  margin: 0;
  font-size: var(--tvz-fs-small);
}
.state__title {
  font-size: var(--tvz-fs-section) !important;
  font-weight: 700;
  color: rgb(var(--v-theme-on-surface));
}
.state__text {
  max-width: 34rem;
}
.state__actions {
  display: flex;
  gap: var(--s1);
  margin-top: var(--s1);
}

/* --- table --------------------------------------------------------------- */
.tbl {
  border: 1px solid var(--tvz-glass-border);
  border-radius: 12px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
  transition: opacity 0.15s ease;
}
.tbl.is-loading {
  opacity: 0.6;
}
.tbl--skel {
  padding: var(--s1);
}
.tbl__head,
.tr {
  display: grid;
  grid-template-columns:
    2rem minmax(0, 1.5fr) minmax(0, 1.1fr) 5.4rem 5.4rem minmax(0, 0.9fr) minmax(0, 0.8fr)
    minmax(0, 1fr) 9.6rem 4.6rem;
  align-items: center;
  column-gap: var(--s2);
  padding: 0 var(--s2);
}
.tbl__head {
  height: 2.4rem;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-bottom: 1px solid var(--tvz-hairline);
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.th {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-transform: inherit;
  letter-spacing: inherit;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
}
.th__i {
  opacity: 0.55;
}
.th:hover,
.th[aria-sort='ascending'],
.th[aria-sort='descending'] {
  color: rgb(var(--v-theme-on-surface));
}
.th[aria-sort='ascending'] .th__i,
.th[aria-sort='descending'] .th__i {
  opacity: 1;
}
.th:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
  border-radius: 3px;
}
.th-r {
  justify-content: flex-end;
  text-align: right;
}
.tgroup {
  padding: 0.3rem var(--s2) 0.3rem calc(var(--s2) + 2rem + var(--s2));
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.55);
  background: rgba(var(--v-theme-on-surface), 0.025);
  border-bottom: 1px solid var(--tvz-hairline);
}
.tr {
  height: var(--row-h);
  border-bottom: 1px solid var(--tvz-hairline);
  font-size: var(--tvz-fs-body);
  cursor: pointer;
  transition: background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.tr:last-child {
  border-bottom: 0;
}
.tr:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.tr:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}
.tr.is-selected,
.tr.is-open {
  background: rgba(var(--v-theme-primary), 0.06);
}
.tr > span {
  min-width: 0;
}
.c-sup,
.c-num {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  overflow: hidden;
}
.ell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.strong {
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
}
.mono {
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), 0.78);
}
.mini {
  flex-shrink: 0;
  padding: 0 0.3rem;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  font-size: var(--tvz-fs-micro);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: rgba(var(--v-theme-on-surface), 0.72);
}
.num.strong {
  color: rgb(var(--v-theme-on-surface));
}
.c-status {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  overflow: hidden;
}
.flag--warning {
  color: rgb(var(--v-theme-warning));
}
.flag--error {
  color: rgb(var(--v-theme-error));
}
.c-act {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
.nodoc {
  display: inline-flex;
  width: 36px;
  justify-content: center;
  color: rgba(var(--v-theme-on-surface), 0.3);
}
.due--overdue {
  color: rgb(var(--v-theme-error));
  font-weight: 600;
}
.due--due_soon {
  color: rgb(var(--v-theme-warning));
  font-weight: 600;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* Laptop width: net and VAT move to the detail panel. */
@container (max-width: 1000px) {
  .tbl__head,
  .tr {
    grid-template-columns: 2rem minmax(0, 1.5fr) minmax(0, 1.1fr) 5.4rem 5.4rem minmax(0, 1fr) 9.6rem 4.6rem;
  }
  .c-net,
  .c-vat {
    display: none;
  }
}
/* Tablet: dates fold away (issue date is in the month group header; the
   status badge already says "overdue N days" / "due in N days"). */
@container (max-width: 780px) {
  .tbl__head,
  .tr {
    grid-template-columns: 2rem minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) 9.6rem 4.6rem;
  }
  .c-date,
  .c-due {
    display: none;
  }
}
/* Phone: a compact two-line row (a real list, not cards). */
@container (max-width: 560px) {
  .tbl__head {
    grid-template-columns: 2rem 1fr;
  }
  .tbl__head > :not(.c-check) {
    display: none;
  }
  .tr {
    height: auto;
    min-height: 3.6rem;
    grid-template-columns: 2rem minmax(0, 1fr) auto;
    grid-template-areas:
      'check sup total'
      'check num status';
    row-gap: 0.1rem;
    padding-block: 0.45rem;
  }
  .tr .c-check {
    grid-area: check;
  }
  .tr .c-sup {
    grid-area: sup;
  }
  .tr .c-num {
    grid-area: num;
    font-size: var(--tvz-fs-small);
  }
  .tr .c-total {
    grid-area: total;
  }
  .tr .c-status {
    grid-area: status;
    justify-content: flex-end;
  }
  /* Every action is in the detail panel, which a tap opens. */
  .tr .c-act {
    display: none;
  }
  .tb {
    flex-wrap: wrap;
  }
  .tb__search {
    flex-basis: 100%;
  }
  .tb__btn {
    flex: 1 1 0;
    max-width: none;
  }
}
.tbl__head .th {
  white-space: normal;
}
</style>
