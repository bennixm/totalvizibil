<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import AdminPager from '@/components/admin/AdminPager.vue'
import AdminSection from '@/components/admin/AdminSection.vue'
import GaChip from '@/components/admin/google-ads/GaChip.vue'
import InvoiceDocument from '@/components/InvoiceDocument.vue'
import { ApiError, apiFetch, BASE_URL } from '@/services/api'
import { useAdminStore, type AdminInvoiceDetail, type AdminInvoiceRow } from '@/stores/admin'
import { useToastStore } from '@/stores/toast'

/** Every invoice of one user, with the real document and its PDF. Voiding
 *  stays on the finance page (Facturi). */
const props = defineProps<{ userId: string }>()
const { t, n } = useI18n()
const admin = useAdminStore()
const toasts = useToastStore()

const PAGE_SIZE = 20
const rows = ref<AdminInvoiceRow[]>([])
const total = ref(0)
const page = ref(1)
const search = ref('')
const status = ref<'issued' | 'void' | null>(null)
const loading = ref(false)
const error = ref('')
let seq = 0

async function load(): Promise<void> {
  const mine = ++seq
  loading.value = true
  try {
    const p = new URLSearchParams({ userId: props.userId, page: String(page.value), pageSize: String(PAGE_SIZE) })
    if (search.value?.trim()) p.set('search', search.value.trim())
    if (status.value) p.set('status', status.value)
    const res = await apiFetch<{ items: AdminInvoiceRow[]; total: number }>(`/admin/invoices?${p}`)
    if (mine !== seq) return
    rows.value = res.items
    total.value = res.total
    error.value = ''
  } catch (e) {
    if (mine === seq) error.value = e instanceof ApiError ? e.message : t('admin.genericError')
  } finally {
    if (mine === seq) loading.value = false
  }
}
let deb: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(deb)
  deb = setTimeout(() => {
    page.value = 1
    void load()
  }, 300)
})
watch(status, () => {
  page.value = 1
  void load()
})
watch(page, () => void load())
watch(() => props.userId, () => void load())
onMounted(load)

/** Fiscal amounts are shown in the invoice's own currency, never converted. */
const money = (minor: number, currency: string) =>
  `${n(minor / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
const date = (s: string) => new Date(s).toLocaleDateString()
const pdf = (id: string) => `${BASE_URL}/admin/invoices/${id}/pdf`

const open = ref(false)
const detail = ref<AdminInvoiceDetail | null>(null)
async function show(id: string): Promise<void> {
  open.value = true
  detail.value = null
  try {
    detail.value = await admin.fetchInvoiceDetail(id)
  } catch (e) {
    open.value = false
    toasts.error(e instanceof ApiError ? e.message : t('admin.genericError'))
  }
}
</script>

<template>
  <AdminSection :title="t('admin.navInvoices')" icon="mdi-receipt-text-outline">
    <template #actions>
      <v-btn variant="tonal" size="small" rounded="pill" append-icon="mdi-arrow-right" :to="{ name: 'admin-invoices' }">
        {{ t('admin.invSeeAll') }}
      </v-btn>
    </template>
    <div class="ui__filters">
      <v-text-field v-model="search" :placeholder="t('admin.searchInvoices')" prepend-inner-icon="mdi-magnify" variant="outlined" density="compact" hide-details clearable />
      <v-select
        v-model="status"
        :items="[
          { value: null, title: t('admin.filterAnyStatus') },
          { value: 'issued', title: t('admin.invStatusIssued') },
          { value: 'void', title: t('admin.invStatusVoid') },
        ]"
        variant="outlined"
        density="compact"
        hide-details
      />
    </div>

    <div v-if="loading && !rows.length" class="ui__center"><v-progress-circular indeterminate color="primary" /></div>
    <AdminEmptyState v-else-if="error" icon="mdi-alert-circle-outline" :text="error" />
    <AdminEmptyState v-else-if="!rows.length" icon="mdi-receipt-text-outline" :text="search || status ? t('admin.invNoResultsHint') : t('admin.invoicesNone')" />
    <ul v-else class="ui__list">
      <li v-for="inv in rows" :key="inv.id" class="ui__row">
        <button type="button" class="ui__id" @click="show(inv.id)">
          <b>{{ inv.number }}</b>
          <small>{{ inv.buyerName }}<template v-if="inv.kind === 'affiliate_reward'"> · {{ t('admin.invKindAffiliateReward') }}</template></small>
        </button>
        <span class="ui__date">{{ date(inv.issuedAt) }}</span>
        <GaChip :tone="inv.voidedAt ? 'error' : 'success'">{{ inv.voidedAt ? t('admin.invStatusVoid') : t('admin.invStatusIssued') }}</GaChip>
        <b class="ui__total">{{ money(inv.totalMinor, inv.currency) }}</b>
        <span class="ui__actions">
          <v-btn size="small" variant="tonal" @click="show(inv.id)">{{ t('admin.invDetail') }}</v-btn>
          <v-btn :href="pdf(inv.id)" download size="small" variant="text" icon="mdi-file-download-outline" :title="t('wallet.paymentsDownloadPdf')" :aria-label="t('wallet.paymentsDownloadPdf')" />
        </span>
      </li>
    </ul>
    <AdminPager :page="page" :page-size="PAGE_SIZE" :total="total" @update:page="page = $event" />

    <v-dialog v-model="open" max-width="920" scrollable>
      <v-card rounded="lg">
        <div v-if="!detail" class="ui__center"><v-progress-circular indeterminate color="primary" /></div>
        <template v-else>
          <v-card-title class="ui__title">{{ t('admin.invDetailTitle', { number: detail.number }) }}</v-card-title>
          <v-card-text>
            <p v-if="detail.voidedAt" class="ui__void">
              {{ t('admin.invVoidedOn', { date: date(detail.voidedAt) }) }}<template v-if="detail.voidReason">: {{ detail.voidReason }}</template>
            </p>
            <InvoiceDocument :invoice="detail" />
          </v-card-text>
          <v-card-actions>
            <v-btn variant="text" :href="pdf(detail.id)" download prepend-icon="mdi-file-download-outline">{{ t('wallet.paymentsDownloadPdf') }}</v-btn>
            <v-spacer />
            <v-btn variant="tonal" @click="open = false">{{ t('common.close') }}</v-btn>
          </v-card-actions>
        </template>
      </v-card>
    </v-dialog>
  </AdminSection>
</template>

<style scoped>
.ui__filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 12rem);
  gap: 0.6rem;
  margin-bottom: 1rem;
}
.ui__center {
  display: grid;
  place-items: center;
  min-height: 160px;
}
.ui__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.ui__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto minmax(6rem, auto) auto;
  align-items: center;
  gap: 0.5rem 1rem;
  padding: 0.7rem 0;
  border-top: 1px solid var(--tvz-hairline);
}
.ui__row:first-child {
  border-top: 0;
}
.ui__id {
  display: flex;
  flex-direction: column;
  min-width: 0;
  text-align: left;
  overflow-wrap: anywhere;
}
.ui__id small,
.ui__date {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ui__total {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.ui__actions {
  display: flex;
  align-items: center;
}
.ui__title {
  white-space: normal;
}
.ui__void {
  margin: 0 0 1rem;
  color: rgb(var(--v-theme-error));
}
@media (max-width: 720px) {
  .ui__filters {
    grid-template-columns: minmax(0, 1fr);
  }
  .ui__row {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .ui__actions {
    justify-content: flex-end;
    grid-column: 1 / -1;
  }
  .ui__total {
    text-align: left;
  }
}
</style>
