<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminPager from '@/components/admin/AdminPager.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import InvoiceDocument from '@/components/InvoiceDocument.vue'
import {
  useAdminStore,
  type AdminInvoiceDetail,
  type AdminInvoiceRow,
  type InvoiceKindFilter,
  type InvoiceStatusFilter,
} from '@/stores/admin'
import { useToastStore } from '@/stores/toast'
import { ApiError } from '@/services/api'

const { t, n } = useI18n()
const admin = useAdminStore()

const search = ref(admin.invoiceFilters.search)
let deb: ReturnType<typeof setTimeout> | undefined
watch(search, (v) => {
  clearTimeout(deb)
  deb = setTimeout(() => admin.setInvoiceFilter('search', v), 300)
})

const statusItems = computed(() => [
  { value: null, title: t('admin.filterAnyStatus') },
  { value: 'issued', title: t('admin.invStatusIssued') },
  { value: 'void', title: t('admin.invStatusVoid') },
])
const kindItems = computed(() => [
  { value: null, title: t('admin.invFilterAnyKind') },
  { value: 'topup', title: t('admin.invKindTopup') },
  { value: 'affiliate_reward', title: t('admin.invKindAffiliateReward') },
])

function total(minor: number): string {
  return `${n(minor / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON`
}
function buyerKindLabel(kind: 'individual' | 'company'): string {
  return kind === 'company' ? t('account.billingKindCompany') : t('account.billingKindIndividual')
}

const toasts = useToastStore()
function flash(text: string, color: 'success' | 'error' = 'success') {
  toasts.push(color === 'error' ? 'error' : 'success', text)
}
function errText(e: unknown, fb: string) {
  return e instanceof ApiError ? e.message : fb
}

const voidTarget = ref<{ id: string; number: string } | null>(null)
const voidReason = ref('')
const busy = ref<string | null>(null)

function openVoid(inv: { id: string; number: string }): void {
  voidTarget.value = inv
  voidReason.value = ''
}
async function confirmVoid(): Promise<void> {
  if (!voidTarget.value || voidReason.value.trim().length < 3) return
  const id = voidTarget.value.id
  busy.value = 'void-' + id
  try {
    await admin.voidInvoice(id, voidReason.value.trim())
    flash(t('admin.invVoided'))
    voidTarget.value = null
    if (detail.value?.id === id) detail.value = null
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    busy.value = null
  }
}
async function unvoid(inv: { id: string; number: string }): Promise<void> {
  busy.value = 'unvoid-' + inv.id
  try {
    await admin.unvoidInvoice(inv.id)
    flash(t('admin.invUnvoided'))
    if (detail.value?.id === inv.id) detail.value = null
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    busy.value = null
  }
}

// --- detail dialog -----------------------------------------------------
const detailOpen = ref(false)
const detailLoading = ref(false)
const detail = ref<AdminInvoiceDetail | null>(null)

async function openDetail(inv: AdminInvoiceRow): Promise<void> {
  detailOpen.value = true
  detailLoading.value = true
  detail.value = null
  try {
    detail.value = await admin.fetchInvoiceDetail(inv.id)
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
    detailOpen.value = false
  } finally {
    detailLoading.value = false
  }
}
function kindLabel(kind: AdminInvoiceDetail['kind']): string {
  return kind === 'affiliate_reward' ? t('admin.invKindAffiliateReward') : t('admin.invKindTopup')
}

onMounted(() => admin.fetchInvoices())
</script>

<template>
  <div class="ai">
    <AdminPageHeader
      :title="t('admin.navInvoices')"
      :eyebrow="t('admin.navGroupManage')"
      :count="admin.invoicesTotal"
    />

    <div class="ai__filters">
      <v-text-field
        v-model="search"
        :placeholder="t('admin.searchInvoices')"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        class="ai__search"
      />
      <v-select
        :model-value="admin.invoiceFilters.status"
        :items="statusItems"
        prepend-inner-icon="mdi-tag-outline"
        variant="outlined"
        density="compact"
        hide-details
        class="ai__sel"
        @update:model-value="admin.setInvoiceFilter('status', $event as InvoiceStatusFilter | null)"
      />
      <v-select
        :model-value="admin.invoiceFilters.kind"
        :items="kindItems"
        prepend-inner-icon="mdi-shape-outline"
        variant="outlined"
        density="compact"
        hide-details
        class="ai__sel"
        @update:model-value="admin.setInvoiceFilter('kind', $event as InvoiceKindFilter | null)"
      />
    </div>

    <div v-if="admin.loadingInvoices && !admin.invoices.length" class="ai__center">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <AdminEmptyState
      v-else-if="!admin.invoices.length"
      icon="mdi-receipt-text-outline"
      :text="admin.invoiceFilters.search || admin.invoiceFilters.status ? t('admin.invNoResultsHint') : t('admin.invoicesNone')"
    />

    <div v-else class="itable">
      <div class="itable__head" aria-hidden="true">
        <span>{{ t('admin.invColInvoice') }}</span>
        <span>{{ t('admin.colTotal') }}</span>
        <span>{{ t('admin.colDate') }}</span>
        <span>{{ t('admin.colStatus') }}</span>
        <span class="itable__headActions">{{ t('admin.invColActions') }}</span>
      </div>

      <ul class="ai__list">
        <li v-for="inv in admin.invoices" :key="inv.id" class="irow" :class="{ 'irow--void': inv.voidedAt }">
          <button type="button" class="irow__id" @click="openDetail(inv)">
            <span class="irow__number">
              {{ inv.number }}
              <span v-if="inv.kind === 'affiliate_reward'" class="tag tag--role">{{ t('admin.invKindAffiliateReward') }}</span>
            </span>
            <span class="irow__buyer">{{ inv.buyerName }} · {{ buyerKindLabel(inv.buyerKind) }}</span>
            <router-link
              :to="{ name: 'admin-user', params: { id: inv.user.id } }"
              class="irow__user"
              @click.stop
            >
              {{ inv.user.email }}
            </router-link>
          </button>

          <span class="irow__cell irow__cell--total">
            <span class="irow__cellLbl">{{ t('admin.colTotal') }}</span>
            <b>{{ total(inv.totalMinor) }}</b>
          </span>
          <span class="irow__cell">
            <span class="irow__cellLbl">{{ t('admin.colDate') }}</span>
            {{ new Date(inv.issuedAt).toLocaleDateString() }}
          </span>
          <span class="irow__cell">
            <span class="irow__cellLbl">{{ t('admin.colStatus') }}</span>
            <span class="chip" :class="inv.voidedAt ? 'chip--err' : 'chip--ok'">
              {{ inv.voidedAt ? t('admin.invStatusVoid') : t('admin.invStatusIssued') }}
            </span>
          </span>

          <div class="irow__actions">
            <v-btn size="small" variant="tonal" @click="openDetail(inv)">
              {{ t('admin.invDetail') }}
            </v-btn>
            <v-btn
              :href="`/account/invoices/${inv.id}`"
              target="_blank"
              rel="noopener"
              size="small"
              variant="text"
              icon="mdi-open-in-new"
              :title="t('admin.invOpenPdf')"
            />
            <v-btn
              v-if="!inv.voidedAt"
              size="small"
              variant="text"
              color="error"
              :loading="busy === 'void-' + inv.id"
              @click="openVoid(inv)"
            >
              {{ t('admin.invVoid') }}
            </v-btn>
            <v-btn
              v-else
              size="small"
              variant="text"
              color="success"
              :loading="busy === 'unvoid-' + inv.id"
              @click="unvoid(inv)"
            >
              {{ t('admin.invUnvoid') }}
            </v-btn>
          </div>
        </li>
      </ul>
    </div>

    <AdminPager
      :page="admin.invoiceFilters.page"
      :page-size="admin.invoiceFilters.pageSize"
      :total="admin.invoicesTotal"
      @update:page="admin.setInvoiceFilter('page', $event)"
    />

    <!-- Detail dialog — the real invoice document, large enough to actually read -->
    <v-dialog v-model="detailOpen" max-width="920" scrollable>
      <v-card rounded="lg">
        <div v-if="detailLoading" class="ai__dCenter">
          <v-progress-circular indeterminate color="primary" />
        </div>
        <template v-else-if="detail">
          <v-card-title class="ai__dTitle">
            <span>{{ t('admin.invDetailTitle', { number: detail.number }) }}</span>
            <span class="chip" :class="detail.voidedAt ? 'chip--err' : 'chip--ok'">
              {{ detail.voidedAt ? t('admin.invStatusVoid') : t('admin.invStatusIssued') }}
            </span>
            <span v-if="detail.kind === 'affiliate_reward'" class="tag tag--role">
              {{ kindLabel(detail.kind) }}
            </span>
            <v-spacer />
            <router-link :to="{ name: 'admin-user', params: { id: detail.user.id } }" class="ai__dUserLink">
              <v-icon icon="mdi-account-outline" size="14" />
              {{ detail.user.email }}
            </router-link>
          </v-card-title>

          <v-card-text class="ai__dBody">
            <div v-if="detail.voidedAt" class="ai__dVoidNote">
              <v-icon icon="mdi-cancel" size="16" />
              <div>
                <strong>{{ t('admin.invVoidedOn', { date: new Date(detail.voidedAt).toLocaleDateString() }) }}</strong>
                <p v-if="detail.voidReason">{{ t('admin.invVoidReasonLabel') }}: {{ detail.voidReason }}</p>
              </div>
            </div>

            <InvoiceDocument :invoice="detail" />
          </v-card-text>

          <v-card-actions>
            <v-btn
              variant="text"
              :href="`/account/invoices/${detail.id}`"
              target="_blank"
              rel="noopener"
              prepend-icon="mdi-open-in-new"
            >
              {{ t('admin.invOpenPdf') }}
            </v-btn>
            <v-spacer />
            <v-btn v-if="!detail.voidedAt" variant="text" color="error" @click="openVoid(detail)">
              {{ t('admin.invVoid') }}
            </v-btn>
            <v-btn v-else variant="text" color="success" @click="unvoid(detail)">
              {{ t('admin.invUnvoid') }}
            </v-btn>
            <v-btn variant="tonal" @click="detailOpen = false">{{ t('common.close') }}</v-btn>
          </v-card-actions>
        </template>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="!!voidTarget" max-width="440" @update:model-value="voidTarget = null">
      <v-card v-if="voidTarget" rounded="lg">
        <v-card-title>{{ t('admin.invVoidTitle', { number: voidTarget.number }) }}</v-card-title>
        <v-card-text>
          <p class="ai__voidNote">{{ t('admin.invVoidNote') }}</p>
          <v-text-field
            v-model="voidReason"
            :label="t('admin.invVoidReason')"
            autofocus
            density="comfortable"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="voidTarget = null">{{ t('common.cancel') }}</v-btn>
          <v-btn
            color="error"
            variant="flat"
            :disabled="voidReason.trim().length < 3"
            :loading="busy === 'void-' + voidTarget.id"
            @click="confirmVoid"
          >
            {{ t('admin.invVoid') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

  </div>
</template>

<style scoped>
.ai__filters {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  padding: 0.7rem;
  margin-bottom: 1.1rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgba(var(--v-theme-on-surface), 0.015);
}
.ai__search {
  flex: 1 1 240px;
}
.ai__sel {
  max-width: 12rem;
}
.ai__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.ai__voidNote {
  margin: 0 0 0.8rem;
  font-size: 0.85rem;
  color: rgba(var(--v-theme-on-surface), 0.65);
}

/* Table shell — a real header row + rows sharing the same column template,
   so amounts/dates/status actually line up like a table. */
.itable {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  overflow: hidden;
}
.itable__head,
.irow {
  display: grid;
  grid-template-columns: minmax(0, 2.3fr) minmax(0, 0.9fr) minmax(0, 0.85fr) minmax(0, 0.75fr) auto;
  align-items: center;
  gap: 1rem;
}
.itable__head {
  padding: 0.65rem 1.1rem;
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.45);
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-bottom: 1px solid var(--tvz-hairline);
}
.itable__headActions {
  text-align: right;
}
.ai__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.irow {
  padding: 0.85rem 1.1rem;
  border-bottom: 1px solid var(--tvz-hairline);
  background: rgb(var(--v-theme-surface));
  transition: background var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease);
}
.irow:last-child {
  border-bottom: none;
}
.irow:hover {
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.irow--void {
  opacity: 0.78;
}
.irow__id {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  text-align: left;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}
.irow__number {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 700;
  font-size: 0.92rem;
  font-family: 'Space Grotesk Variable', sans-serif;
  color: rgb(var(--v-theme-on-surface));
}
.irow__buyer {
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.irow__user {
  font-size: 0.76rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
  align-self: flex-start;
}
.irow__cell {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  font-size: 0.86rem;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.irow__cell--total b {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.irow__cellLbl {
  display: none;
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.irow__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.2rem;
  flex-wrap: wrap;
}

.tag {
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.12rem 0.4rem;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.tag--role {
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}
.chip {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  flex: none;
  font-size: 0.68rem;
  font-weight: 700;
  padding: 0.18rem 0.55rem;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.chip--ok {
  background: rgba(var(--v-theme-success), 0.15);
  color: rgb(var(--v-theme-success));
}
.chip--err {
  background: rgba(var(--v-theme-error), 0.15);
  color: rgb(var(--v-theme-error));
}

/* Detail dialog */
.ai__dCenter {
  display: grid;
  place-items: center;
  min-height: 220px;
}
.ai__dTitle {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.ai__dBody {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.ai__dVoidNote {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.7rem 0.9rem;
  border-radius: 8px;
  background: rgba(var(--v-theme-error), 0.08);
  color: rgb(var(--v-theme-error));
  font-size: 0.85rem;
}
.ai__dVoidNote p {
  margin: 0.2rem 0 0;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.ai__dUserLink {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
  text-decoration: none;
}
.ai__dUserLink:hover {
  color: rgb(var(--v-theme-primary));
}

@media (max-width: 860px) {
  .itable__head {
    display: none;
  }
  .irow {
    grid-template-columns: 1fr;
    row-gap: 0.5rem;
  }
  .irow__actions {
    justify-content: flex-start;
  }
  .irow__cell {
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    padding: 0.3rem 0;
    border-top: 1px dashed var(--tvz-hairline);
  }
  .irow__cellLbl {
    display: inline;
  }
}
</style>
