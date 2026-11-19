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
import AdminExportMenu from '@/components/admin/AdminExportMenu.vue'
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
const showMoreFilters = ref(false)
const moreActive = computed(() => !!(f.processing || f.currency || f.source))
function resetFilters(): void {
  search.value = ''
  store.resetFilters()
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
const supplierFilterName = ref<string | null>(null)
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

const hasAny = computed(() => store.providers.some((p) => p.invoiceCount > 0))
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
    <AdminPageHeader
      class="asi__head"
      :title="t('supplierInvoices.title')"
      :eyebrow="t('admin.navGroupFinance')"
      :sub="t('supplierInvoices.sub')"
    >
      <template #actions>
        <AdminExportMenu v-if="pageTab === 'invoices'" :url-for="(fmtName) => store.exportUrl(fmtName as 'csv' | 'xlsx')" :formats="['xlsx', 'csv']" :disabled="!store.total" />
        <v-menu v-if="pageTab === 'invoices'" location="bottom end">
          <template #activator="{ props: menu }">
            <v-btn v-bind="menu" variant="tonal" size="small" prepend-icon="mdi-folder-zip-outline" append-icon="mdi-chevron-down" :loading="!!zipBusy">
              {{ t('supplierInvoices.zip') }}
            </v-btn>
          </template>
          <v-list density="compact" min-width="240">
            <v-list-item
              prepend-icon="mdi-filter-outline"
              :title="t('supplierInvoices.zipFiltered')"
              :subtitle="t('supplierInvoices.zipFilteredSub', { n: store.total })"
              :disabled="!store.total"
              @click="zip({ filters: true }, 'filters')"
            />
            <v-list-item prepend-icon="mdi-folder-multiple-outline" :title="t('supplierInvoices.downloadAll')" @click="zip({ all: true }, 'all')" />
          </v-list>
        </v-menu>
        <v-btn color="primary" variant="flat" size="small" prepend-icon="mdi-plus" @click="openUpload()">
          {{ t('supplierInvoices.addInvoice') }}
        </v-btn>
      </template>
    </AdminPageHeader>

    <v-tabs v-model="pageTab" density="compact" color="primary" class="asi__tabs" show-arrows>
      <v-tab value="invoices" prepend-icon="mdi-file-document-multiple-outline">{{ t('supplierInvoices.tabInvoices') }}</v-tab>
      <v-tab value="suppliers" prepend-icon="mdi-domain">{{ t('supplierInvoices.tabSuppliers') }}</v-tab>
      <v-tab value="calendar" prepend-icon="mdi-calendar-month-outline">{{ t('supplierInvoices.tabCalendar') }}</v-tab>
      <v-tab value="vat" prepend-icon="mdi-percent-outline">{{ t('supplierInvoices.tabVat') }}</v-tab>
    </v-tabs>

    <SupplierRegistryPanel v-if="pageTab === 'suppliers'" @show-invoices="showSupplier" />
    <DueCalendar v-else-if="pageTab === 'calendar'" @open="openInvoice" />
    <VatReportPanel v-else-if="pageTab === 'vat'" />

    <template v-else>
    <InvoiceInsights :insights="store.insights" @open="openInvoice" @supplier="showSupplier" />

    <SupplierInvoiceSummary :summary="store.summary" :error="store.summaryError" :active="activeKpi" @pick="pickKpi" />

    <SupplierInvoiceSources
      :providers="store.providers"
      :error="store.providersError"
      :syncing="syncBusy"
      :active-provider="f.provider"
      :default-open="store.loaded && !hasAny"
      @sync="syncGoogle"
      @upload="openUpload"
      @filter="(p) => store.setFilter('provider', p)"
    />

    <section class="asi__list">
      <AdminPeriodFilter
        class="asi__period"
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

      <!-- Filters -->
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
        <v-select
          :model-value="f.provider"
          :items="PROVIDER_ITEMS"
          :label="t('supplierInvoices.colProvider')"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          class="tb__sel"
          @update:model-value="store.setFilter('provider', $event ?? null)"
        />
        <v-select
          :model-value="f.payment"
          :items="PAYMENT_ITEMS"
          :label="t('supplierInvoices.colPayment')"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          class="tb__sel"
          @update:model-value="store.setFilter('payment', $event ?? null)"
        />
        <v-select
          :model-value="f.due"
          :items="DUE_ITEMS"
          :label="t('supplierInvoices.colDue')"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          class="tb__sel"
          @update:model-value="store.setFilter('due', $event ?? null)"
        />
        <v-btn
          variant="text"
          size="small"
          :prepend-icon="showMoreFilters ? 'mdi-chevron-up' : 'mdi-tune-variant'"
          :color="moreActive ? 'primary' : undefined"
          class="tb__more"
          :aria-expanded="showMoreFilters"
          @click="showMoreFilters = !showMoreFilters"
        >
          {{ t('supplierInvoices.moreFilters') }}
        </v-btn>
        <div v-if="showMoreFilters || moreActive" class="tb__extra">
          <v-select
            :model-value="f.processing"
            :items="PROC_ITEMS"
            :label="t('supplierInvoices.colProcessing')"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            @update:model-value="store.setFilter('processing', $event ?? null)"
          />
          <v-select
            :model-value="f.currency"
            :items="store.currencies"
            :label="t('supplierInvoices.currency')"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            @update:model-value="store.setFilter('currency', $event ?? null)"
          />
          <v-select
            :model-value="f.source"
            :items="SOURCE_ITEMS"
            :label="t('supplierInvoices.colSource')"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            @update:model-value="store.setFilter('source', $event ?? null)"
          />
        </div>
      </div>

      <!-- Result line: count, totals per currency, reset -->
      <div class="res">
        <span class="res__count">{{ t('supplierInvoices.resultCount', { n: store.total }) }}</span>
        <v-chip v-if="f.supplierId" size="small" closable prepend-icon="mdi-domain" @click:close="clearSupplier">
          {{ supplierFilterName ?? t('supplierInvoices.oneSupplier') }}
        </v-chip>
        <span v-for="tot in store.totalsByCurrency" :key="tot.currency" class="res__tot">
          <b>{{ fmt.amount(tot.totalMinor, tot.currency) }}</b>
          <small v-if="tot.taxMinor">{{ t('supplierInvoices.vatIncluded', { amount: fmt.amount(tot.taxMinor, tot.currency) }) }}</small>
        </span>
        <v-btn v-if="store.activeFilterCount" variant="text" size="small" prepend-icon="mdi-filter-remove-outline" class="res__reset" @click="resetFilters">
          {{ t('supplierInvoices.resetFilters') }} ({{ store.activeFilterCount }})
        </v-btn>
      </div>

      <!-- Bulk bar -->
      <div v-if="selected.size" class="bulk" role="region" :aria-label="t('supplierInvoices.bulkLabel')">
        <span class="bulk__n">{{ t('supplierInvoices.selectedCount', { n: selected.size }) }}</span>
        <v-btn size="small" variant="tonal" color="success" prepend-icon="mdi-cash-check" :loading="bulkBusy === 'mark_paid'" @click="bulk('mark_paid')">
          {{ t('supplierInvoices.markPaid') }}
        </v-btn>
        <v-btn size="small" variant="tonal" prepend-icon="mdi-cash-remove" :loading="bulkBusy === 'mark_unpaid'" @click="bulk('mark_unpaid')">
          {{ t('supplierInvoices.markUnpaid') }}
        </v-btn>
        <v-btn size="small" variant="tonal" color="primary" prepend-icon="mdi-shield-check-outline" :loading="bulkBusy === 'mark_verified'" @click="bulk('mark_verified')">
          {{ t('supplierInvoices.markVerified') }}
        </v-btn>
        <v-btn size="small" variant="tonal" prepend-icon="mdi-folder-zip-outline" :loading="zipBusy === 'sel'" @click="zip({ ids: [...selected] }, 'sel')">
          {{ t('supplierInvoices.zip') }}
        </v-btn>
        <v-btn size="small" variant="text" class="bulk__clear" @click="selected = new Set()">{{ t('supplierInvoices.clearSelection') }}</v-btn>
      </div>

      <!-- Table -->
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
          <v-btn v-else color="primary" variant="flat" size="small" prepend-icon="mdi-plus" @click="openUpload()">
            {{ t('supplierInvoices.addInvoice') }}
          </v-btn>
        </div>
      </div>

      <div v-else class="tbl" :class="{ 'is-loading': store.loading }" role="table" :aria-label="t('supplierInvoices.title')">
        <div class="tbl__head" role="row">
          <span class="c-check" role="columnheader">
            <v-checkbox-btn
              color="primary"
              :model-value="allOnPage"
              :indeterminate="someOnPage"
              density="compact"
              :aria-label="t('supplierInvoices.selectPage')"
              @update:model-value="toggleAll"
            />
          </span>
          <button type="button" class="c-sup th" role="columnheader" :aria-sort="ariaSort('provider')" @click="store.toggleSort('provider')">
            {{ t('supplierInvoices.colProvider') }} <v-icon :icon="sortIcon('provider')" size="13" />
          </button>
          <button type="button" class="c-num th" role="columnheader" :aria-sort="ariaSort('invoiceNumber')" @click="store.toggleSort('invoiceNumber')">
            {{ t('supplierInvoices.colNumber') }} <v-icon :icon="sortIcon('invoiceNumber')" size="13" />
          </button>
          <button type="button" class="c-date th" role="columnheader" :aria-sort="ariaSort('issueDate')" @click="store.toggleSort('issueDate')">
            {{ t('supplierInvoices.colIssuedShort') }} <v-icon :icon="sortIcon('issueDate')" size="13" />
          </button>
          <button type="button" class="c-date th" role="columnheader" :aria-sort="ariaSort('dueDate')" @click="store.toggleSort('dueDate')">
            {{ t('supplierInvoices.colDue') }} <v-icon :icon="sortIcon('dueDate')" size="13" />
          </button>
          <span class="c-net th-r" role="columnheader">{{ t('supplierInvoices.colNet') }}</span>
          <span class="c-vat th-r" role="columnheader">{{ t('supplierInvoices.colVat') }}</span>
          <button type="button" class="c-total th th-r" role="columnheader" :aria-sort="ariaSort('totalMinor')" @click="store.toggleSort('totalMinor')">
            {{ t('supplierInvoices.colTotal') }} <v-icon :icon="sortIcon('totalMinor')" size="13" />
          </button>
          <span class="c-status" role="columnheader">{{ t('supplierInvoices.colStatus') }}</span>
          <span class="c-act" role="columnheader"><span class="sr-only">{{ t('supplierInvoices.colActions') }}</span></span>
        </div>

        <div
          v-for="r in store.items"
          :key="r.id"
          class="tr"
          :class="{ 'is-selected': selected.has(r.id), 'is-open': openId === r.id }"
          role="row"
          tabindex="0"
          :aria-label="`${r.providerName} ${r.invoiceNumber ?? ''}`"
          @click="openInvoice(r.id)"
          @keydown="onRowKey($event, r)"
        >
          <span class="c-check" role="cell" @click.stop>
            <v-checkbox-btn
              color="primary"
              :model-value="selected.has(r.id)"
              density="compact"
              :aria-label="t('supplierInvoices.selectRow', { n: r.invoiceNumber ?? r.id })"
              @update:model-value="toggle(r.id)"
            />
          </span>
          <span class="c-sup" role="cell">
            <span class="sup">
              <v-icon :icon="fmt.sourceIcon(r.source)" size="14" class="sup__src" :title="fmt.sourceLabel(r.source)" />
              <b>{{ r.providerName }}</b>
            </span>
            <small v-if="r.supplierVatId" class="sub">{{ r.supplierVatId }}</small>
          </span>
          <span class="c-num" role="cell">
            <span class="mono">{{ r.invoiceNumber ?? '-' }}</span>
            <small v-if="r.docType && r.docType !== 'INVOICE'" class="sub">{{ r.docType }}</small>
          </span>
          <span class="c-date c-date--issued" role="cell" :data-label="t('supplierInvoices.colIssuedShort')">{{ fmt.date(r.issueDate) }}</span>
          <span class="c-date c-date--due" role="cell" :data-label="t('supplierInvoices.colDue')" :class="r.dueState ? `due--${r.dueState}` : ''">
            {{ fmt.date(r.dueDate) }}
          </span>
          <span class="c-net num" role="cell">{{ fmt.amount(r.subtotalMinor, r.currency) }}</span>
          <span class="c-vat num" role="cell">{{ fmt.amount(r.taxMinor, r.currency) }}</span>
          <span class="c-total num" role="cell">
            <b>{{ fmt.amount(r.totalMinor, r.currency) }}</b>
            <small class="sub cur">{{ r.currency }}</small>
          </span>
          <span class="c-status" role="cell">
            <InvoiceBadge v-bind="fmt.payment(r)" />
            <InvoiceBadge v-if="r.processingStatus === 'needs_review'" v-bind="fmt.processing(r)" />
          </span>
          <span class="c-act" role="cell" @click.stop>
            <v-icon v-if="r.attachmentCount" icon="mdi-paperclip" size="14" class="att" :title="t('supplierInvoices.nFiles', { n: r.attachmentCount })" />
            <v-btn
              v-if="r.document"
              icon="mdi-eye-outline"
              size="small"
              variant="text"
              :href="store.documentUrl(r.id, true)"
              target="_blank"
              rel="noopener"
              :aria-label="t('supplierInvoices.open')"
              :title="t('supplierInvoices.open')"
            />
            <v-tooltip v-else :text="r.documentError ? fmt.reason(r.documentError) : t('supplierInvoices.noDocument')" location="top">
              <template #activator="{ props: tip }">
                <span v-bind="tip" class="nodoc"><v-icon icon="mdi-file-alert-outline" size="17" /></span>
              </template>
            </v-tooltip>
            <v-btn
              v-if="r.document"
              icon="mdi-download-outline"
              size="small"
              variant="text"
              :href="store.documentUrl(r.id)"
              :aria-label="t('supplierInvoices.download')"
              :title="t('supplierInvoices.download')"
            />
          </span>
        </div>
      </div>

      <AdminPager :page="f.page" :page-size="f.pageSize" :total="store.total" @update:page="store.setFilter('page', $event)" />
    </section>
    </template>

    <SupplierInvoiceUploadDialog v-model="uploadOpen" :provider="uploadProvider" @saved="openInvoice" />
    <SupplierInvoiceDrawer :invoice-id="openId" @close="openInvoice(null)" @open="openInvoice" />
  </div>
</template>

<style scoped>
.asi {
  --asi-gap: 1rem;
  display: flex;
  flex-direction: column;
  gap: var(--asi-gap);
  max-width: 1180px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.asi .asi__head {
  margin: 0;
}
.asi__tabs {
  border-bottom: 1px solid var(--tvz-hairline);
}
/* Four tabs fit a phone without scrolling once the icons go. */
@media (max-width: 600px) {
  .asi__tabs :deep(.v-tab .v-icon) {
    display: none;
  }
  .asi__tabs :deep(.v-tab) {
    padding-inline: 0.7rem;
    min-width: 0;
  }
}
.asi__list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  container-type: inline-size;
}
.asi__list .asi__period {
  margin: 0.25rem 0 0;
  padding-bottom: 0.9rem;
}

/* --- toolbar ------------------------------------------------------------ */
.tb {
  display: grid;
  grid-template-columns: minmax(14rem, 1.6fr) repeat(3, minmax(0, 1fr)) auto;
  gap: 0.55rem;
  align-items: center;
}
.tb__extra {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 12rem));
  gap: 0.55rem;
}
.res {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.3rem 1.2rem;
  font-size: var(--tvz-fs-small);
}
.res__count {
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.res__tot b {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-variant-numeric: tabular-nums;
}
.res__tot small {
  margin-left: 0.3rem;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.res__reset {
  margin-left: auto;
}

/* --- bulk bar ------------------------------------------------------------- */
.bulk {
  position: sticky;
  top: 0.5rem;
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.7rem;
  border: 1px solid rgba(var(--v-theme-primary), 0.45);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
}
.bulk__n {
  margin-right: 0.35rem;
  font-size: var(--tvz-fs-body);
  font-weight: 700;
}
.bulk__clear {
  margin-left: auto;
}

/* --- states ------------------------------------------------------------- */
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
  margin-top: 0.5rem;
}

/* --- table ------------------------------------------------------------- */
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
  padding: 0.5rem;
}
.tbl__head,
.tr {
  display: grid;
  grid-template-columns:
    2rem minmax(0, 1.35fr) minmax(0, 1fr) 5.6rem 5.6rem minmax(0, 0.85fr) minmax(0, 0.75fr)
    minmax(0, 0.95fr) minmax(0, 1.05fr) 4.6rem;
  align-items: center;
  gap: 0.65rem;
  padding: 0 0.9rem;
}
.tbl__head {
  min-height: 2.4rem;
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
  white-space: nowrap;
  overflow: hidden;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-transform: inherit;
  letter-spacing: inherit;
  cursor: pointer;
}
.th:hover,
.th[aria-sort='ascending'],
.th[aria-sort='descending'] {
  color: rgb(var(--v-theme-on-surface));
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
.tr {
  min-height: 3.4rem;
  padding-block: 0.45rem;
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
.c-num,
.c-total {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.sup {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
}
.sup b {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.sup__src {
  flex-shrink: 0;
  color: rgba(var(--v-theme-on-surface), 0.42);
}
.sub {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono {
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.c-total {
  align-items: flex-end;
}
.c-total b {
  font-family: 'Space Grotesk Variable', sans-serif;
  color: rgb(var(--v-theme-on-surface));
  white-space: nowrap;
}
.cur {
  display: none;
}
.c-status {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.c-act {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0;
}
.att {
  margin-right: 0.15rem;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.nodoc {
  display: inline-flex;
  padding: 0.4rem;
  color: rgba(var(--v-theme-on-surface), 0.35);
  cursor: help;
}
.due--overdue {
  color: rgb(var(--v-theme-error));
  font-weight: 700;
}
.due--due_soon {
  color: rgb(var(--v-theme-warning));
  font-weight: 700;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* Medium width: drop net/VAT columns (both are in the detail panel). */
@container (max-width: 1020px) {
  .tbl__head,
  .tr {
    grid-template-columns:
      2rem minmax(0, 1.4fr) minmax(0, 1fr) 5.6rem 5.6rem minmax(0, 1fr) minmax(0, 1.1fr) 4.6rem;
  }
  .c-net,
  .c-vat {
    display: none;
  }
  .tb {
    grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
  }
  .tb__search {
    grid-column: 1 / -1;
  }
}

/* Narrow: each invoice becomes a compact card. */
@container (max-width: 680px) {
  .tbl__head {
    grid-template-columns: 2rem 1fr;
  }
  .tbl__head > :not(.c-check) {
    display: none;
  }
  .tr {
    grid-template-columns: 2rem minmax(0, 1fr) auto;
    grid-template-areas:
      'check sup total'
      'check num act'
      'check issued due'
      'check status status';
    row-gap: 0.3rem;
    padding-block: 0.7rem;
  }
  .tr .c-check {
    grid-area: check;
    align-self: start;
  }
  .tr .c-sup {
    grid-area: sup;
  }
  .tr .c-num {
    grid-area: num;
    font-size: var(--tvz-fs-small);
    color: rgba(var(--v-theme-on-surface), 0.7);
  }
  .tr .c-total {
    grid-area: total;
    align-self: start;
  }
  .tr .c-date {
    display: inline;
    font-size: var(--tvz-fs-caption);
  }
  .tr .c-date--issued {
    grid-area: issued;
  }
  .tr .c-date--due {
    grid-area: due;
    text-align: right;
  }
  .tr .c-date[data-label]::before {
    content: attr(data-label) ': ';
    color: rgba(var(--v-theme-on-surface), 0.45);
  }
  .tr .c-status {
    grid-area: status;
  }
  .tr .c-act {
    grid-area: act;
    margin-block: -0.35rem;
  }
  .cur {
    display: none;
  }
  .tb {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .tb__more {
    justify-self: start;
  }
  .tb__extra {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .res__reset {
    margin-left: 0;
  }
}
</style>
