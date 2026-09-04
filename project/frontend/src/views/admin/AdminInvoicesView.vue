<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminPager from '@/components/admin/AdminPager.vue'
import { useAdminStore, type AdminInvoiceRow, type InvoiceStatusFilter } from '@/stores/admin'
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

function total(minor: number): string {
  return `${n(minor / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON`
}
function buyerKindLabel(kind: 'individual' | 'company'): string {
  return kind === 'company' ? t('account.billingKindCompany') : t('account.billingKindIndividual')
}

const toast = reactive({ show: false, text: '', color: 'success' })
function flash(text: string, color: 'success' | 'error' = 'success') {
  Object.assign(toast, { show: true, text, color })
}
function errText(e: unknown, fb: string) {
  return e instanceof ApiError ? e.message : fb
}

const voidTarget = ref<AdminInvoiceRow | null>(null)
const voidReason = ref('')
const busy = ref<string | null>(null)

function openVoid(inv: AdminInvoiceRow): void {
  voidTarget.value = inv
  voidReason.value = ''
}
async function confirmVoid(): Promise<void> {
  if (!voidTarget.value || voidReason.value.trim().length < 3) return
  busy.value = 'void-' + voidTarget.value.id
  try {
    await admin.voidInvoice(voidTarget.value.id, voidReason.value.trim())
    flash(t('admin.invVoided'))
    voidTarget.value = null
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    busy.value = null
  }
}
async function unvoid(inv: AdminInvoiceRow): Promise<void> {
  busy.value = 'unvoid-' + inv.id
  try {
    await admin.unvoidInvoice(inv.id)
    flash(t('admin.invUnvoided'))
  } catch (e) {
    flash(errText(e, t('admin.genericError')), 'error')
  } finally {
    busy.value = null
  }
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
        variant="outlined"
        density="compact"
        hide-details
        class="ai__sel"
        @update:model-value="admin.setInvoiceFilter('status', $event as InvoiceStatusFilter | null)"
      />
    </div>

    <div v-if="admin.loadingInvoices && !admin.invoices.length" class="ai__center">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <p v-else-if="!admin.invoices.length" class="ai__empty">{{ t('admin.invoicesNone') }}</p>

    <ul v-else class="ai__list">
      <li v-for="inv in admin.invoices" :key="inv.id" class="irow" :class="{ 'irow--void': inv.voidedAt }">
        <div class="irow__id">
          <span class="irow__number">
            {{ inv.number }}
            <span v-if="inv.voidedAt" class="tag tag--err">{{ t('admin.invStatusVoid') }}</span>
          </span>
          <span class="irow__buyer">{{ inv.buyerName }} · {{ buyerKindLabel(inv.buyerKind) }}</span>
          <router-link :to="{ name: 'admin-user', params: { id: inv.user.id } }" class="irow__user">
            {{ inv.user.email }}
          </router-link>
        </div>
        <div class="irow__stats">
          <span class="irow__stat">
            <b>{{ total(inv.totalMinor) }}</b>
            <em>{{ t('admin.colTotal') }}</em>
          </span>
          <span class="irow__stat irow__stat--wide">
            <b class="irow__date">{{ new Date(inv.issuedAt).toLocaleDateString() }}</b>
            <em>{{ t('admin.colDate') }}</em>
          </span>
        </div>
        <div class="irow__actions">
          <a :href="`/account/invoices/${inv.id}`" target="_blank" rel="noopener" class="irow__view">
            {{ t('invoices.view') }}
            <v-icon icon="mdi-open-in-new" size="13" />
          </a>
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

    <AdminPager
      :page="admin.invoiceFilters.page"
      :page-size="admin.invoiceFilters.pageSize"
      :total="admin.invoicesTotal"
      @update:page="admin.setInvoiceFilter('page', $event)"
    />

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

    <v-snackbar v-model="toast.show" :color="toast.color" timeout="2600">{{ toast.text }}</v-snackbar>
  </div>
</template>

<style scoped>
.ai__filters {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-bottom: 1.1rem;
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
.ai__empty {
  padding: 3rem 1rem;
  text-align: center;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.ai__voidNote {
  margin: 0 0 0.8rem;
  font-size: 0.85rem;
  color: rgb(var(--v-theme-on-surface) / 0.65);
}
.ai__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.irow {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.9rem 1.1rem;
  border: 1px solid var(--tvz-hairline);
  border-left: 3px solid transparent;
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
}
.irow--void {
  border-left-color: rgb(var(--v-theme-error) / 0.6);
  opacity: 0.85;
}
.irow__id {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.irow__number {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 700;
  font-size: 0.92rem;
  font-family: 'Space Grotesk Variable', sans-serif;
}
.irow__buyer {
  font-size: 0.8rem;
  color: rgb(var(--v-theme-on-surface) / 0.7);
}
.irow__user {
  font-size: 0.76rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.irow__stats {
  display: flex;
  align-items: center;
  gap: 1.4rem;
  flex: none;
}
.irow__stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
  min-width: 4rem;
}
.irow__stat b {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: 0.92rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.irow__stat em {
  font-style: normal;
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
.irow__actions {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex: none;
}
.irow__view {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0 0.6rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
}
.tag {
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.12rem 0.4rem;
  border-radius: 4px;
  background: rgb(var(--v-theme-on-surface) / 0.08);
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.tag--err {
  background: rgb(var(--v-theme-error) / 0.16);
  color: rgb(var(--v-theme-error));
}

@media (max-width: 780px) {
  .irow__stats {
    display: none;
  }
}
</style>
