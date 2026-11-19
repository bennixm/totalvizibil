<script setup lang="ts">
/**
 * Supplier registry: one row per supplier we receive invoices from (created
 * automatically at ingestion), with its totals, unpaid count and monthly
 * pattern. Staff add the VAT id, billing e-mail and payment terms; the
 * terms fill in a missing due date on future invoices.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useMoneyStore } from '@/stores/money'

import { useConfirmStore } from '@/stores/confirm'
import { useExternalInvoicesStore, type SupplierRow } from '@/stores/externalInvoices'
import { useToastStore } from '@/stores/toast'

import { useInvoiceFormat } from './useInvoiceFormat'

const emit = defineEmits<{ showInvoices: [supplierId: string] }>()

const { t } = useI18n()
const store = useExternalInvoicesStore()
const toasts = useToastStore()
const confirm = useConfirmStore()
const fmt = useInvoiceFormat()

const rows = ref<SupplierRow[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const q = ref('')

async function load(): Promise<void> {
  loading.value = true
  try {
    rows.value = await store.fetchSuppliers()
    error.value = null
  } catch (e) {
    error.value = fmt.errText(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
// Amounts are in the platform display currency: reload when it changes.
watch(() => useMoneyStore().currency, load)

const filtered = computed(() => {
  const s = q.value.trim().toLowerCase()
  return s
    ? rows.value.filter((r) => [r.name, r.vatId, r.email].some((v) => v?.toLowerCase().includes(s)))
    : rows.value
})

const edit = reactive({
  open: false,
  id: '',
  name: '',
  vatId: '',
  email: '',
  terms: null as number | null,
  currency: null as string | null,
  notes: '',
  busy: false,
})
function openEdit(r: SupplierRow): void {
  Object.assign(edit, {
    open: true,
    id: r.id,
    name: r.name,
    vatId: r.vatId ?? '',
    email: r.email ?? '',
    terms: r.paymentTermsDays,
    currency: r.defaultCurrency,
    notes: r.notes ?? '',
    busy: false,
  })
}
function remove(r: SupplierRow): void {
  confirm.ask(
    t('supplierInvoices.removeSupplierTitle'),
    t('supplierInvoices.removeSupplierText', { name: r.name }),
    async () => {
      try {
        await store.removeSupplier(r.id)
        await load()
      } catch (e) {
        toasts.error(fmt.errText(e))
      }
    },
  )
}

async function save(): Promise<void> {
  edit.busy = true
  try {
    const terms = edit.terms === null || String(edit.terms) === '' ? null : Math.max(0, Math.round(Number(edit.terms)))
    await store.updateSupplier(edit.id, {
      vatId: edit.vatId.trim() || null,
      email: edit.email.trim() || null,
      paymentTermsDays: terms,
      defaultCurrency: edit.currency || null,
      notes: edit.notes.trim() || null,
    })
    edit.open = false
    toasts.success(t('supplierInvoices.saved'))
    await load()
  } catch (e) {
    toasts.error(fmt.errText(e))
  } finally {
    edit.busy = false
  }
}
</script>

<template>
  <section class="reg">
    <div class="reg__bar">
      <v-text-field
        v-model="q"
        prepend-inner-icon="mdi-magnify"
        :placeholder="t('supplierInvoices.regSearch')"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        class="reg__search"
      />
      <span class="reg__count">{{ t('supplierInvoices.regCount', { n: rows.length }) }}</span>
    </div>
    <p class="reg__hint">{{ t('supplierInvoices.regHint') }}</p>

    <v-skeleton-loader v-if="loading && !rows.length" type="table-row-divider@4" />
    <p v-else-if="error" class="reg__error">{{ error }}</p>
    <div v-else-if="!filtered.length" class="reg__empty">
      <v-icon icon="mdi-domain" size="26" />
      <p>{{ rows.length ? t('supplierInvoices.noMatches') : t('supplierInvoices.regEmpty') }}</p>
    </div>

    <ul v-else class="reg__list">
      <li v-for="r in filtered" :key="r.id" class="sup">
        <div class="sup__main">
          <div class="sup__name">
            <strong>{{ r.name }}</strong>
            <span v-if="r.recurring" class="sup__tag" :title="t('supplierInvoices.recurringTitle', { day: r.recurring.usualDay })">
              <v-icon icon="mdi-repeat" size="12" /> {{ t('supplierInvoices.monthly') }}
            </span>
            <span v-if="r.recurring?.missingThisMonth" class="sup__tag sup__tag--warn">
              <v-icon icon="mdi-alert-outline" size="12" /> {{ t('supplierInvoices.missingThisMonth') }}
            </span>
          </div>
          <div class="sup__meta">
            <span>{{ r.vatId ?? t('supplierInvoices.noVatId') }}</span>
            <span v-if="r.email">{{ r.email }}</span>
            <span>
              {{ r.paymentTermsDays !== null ? t('supplierInvoices.termsDays', { n: r.paymentTermsDays }) : t('supplierInvoices.noTerms') }}
            </span>
          </div>
        </div>
        <div class="sup__stats">
          <span class="sup__tot">
            <b v-for="tot in r.totals.slice(0, 2)" :key="tot.currency">{{ fmt.amount(tot.totalMinor, tot.currency) }}</b>
          </span>
          <span class="sup__sub">
            {{ t('supplierInvoices.regStats', { n: r.invoiceCount, unpaid: r.unpaidCount }) }}
            <template v-if="r.lastIssueDate"> · {{ t('supplierInvoices.lastInvoice', { date: fmt.date(r.lastIssueDate) }) }}</template>
          </span>
        </div>
        <div class="sup__actions">
          <v-btn size="small" variant="text" prepend-icon="mdi-format-list-bulleted" :disabled="!r.invoiceCount" @click="emit('showInvoices', r.id)">
            {{ t('supplierInvoices.showInvoices') }}
          </v-btn>
          <v-btn size="small" variant="text" icon="mdi-pencil-outline" :aria-label="t('supplierInvoices.edit')" :title="t('supplierInvoices.edit')" @click="openEdit(r)" />
          <v-btn
            v-if="!r.invoiceCount"
            size="small"
            variant="text"
            color="error"
            icon="mdi-trash-can-outline"
            :aria-label="t('supplierInvoices.delete')"
            :title="t('supplierInvoices.delete')"
            @click="remove(r)"
          />
        </div>
      </li>
    </ul>

    <v-dialog v-model="edit.open" max-width="480">
      <v-card rounded="lg">
        <v-card-title>{{ edit.name }}</v-card-title>
        <v-card-text class="d-flex flex-column ga-1">
          <v-text-field v-model="edit.vatId" :label="t('supplierInvoices.vatId')" density="comfortable" maxlength="40" />
          <v-text-field v-model="edit.email" type="email" :label="t('supplierInvoices.billingEmail')" density="comfortable" maxlength="200" />
          <v-text-field
            v-model.number="edit.terms"
            type="number"
            min="0"
            max="365"
            :label="t('supplierInvoices.paymentTerms')"
            :hint="t('supplierInvoices.paymentTermsHint')"
            persistent-hint
            :suffix="t('supplierInvoices.days')"
            density="comfortable"
            class="mb-2"
          />
          <v-select
            v-model="edit.currency"
            :items="['EUR', 'RON', 'USD', 'GBP']"
            :label="t('supplierInvoices.defaultCurrency')"
            clearable
            density="comfortable"
          />
          <v-textarea v-model="edit.notes" :label="t('supplierInvoices.notes')" rows="2" auto-grow density="comfortable" maxlength="1000" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="edit.open = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :loading="edit.busy" @click="save">{{ t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.reg {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  container-type: inline-size;
}
.reg__bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.reg__search {
  max-width: 26rem;
}
.reg__count {
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.reg__hint {
  margin: 0;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.62);
}
.reg__error {
  color: rgb(var(--v-theme-error));
  font-size: var(--tvz-fs-small);
}
.reg__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  padding: 2.5rem 1rem;
  border: 1px dashed var(--tvz-glass-border);
  border-radius: 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: var(--tvz-fs-small);
}
.reg__empty p {
  margin: 0;
}
.reg__list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}
.sup {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) auto;
  gap: 0.5rem 1rem;
  align-items: center;
  padding: 0.7rem 1rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.sup:last-child {
  border-bottom: 0;
}
.sup__main,
.sup__stats {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.sup__name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  font-size: var(--tvz-fs-body);
}
.sup__tag {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  padding: 0.05rem 0.4rem;
  border-radius: 4px;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
}
.sup__tag--warn {
  background: rgba(var(--v-theme-warning), 0.15);
  color: rgb(var(--v-theme-warning));
}
.sup__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem 0.9rem;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.sup__tot {
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.6rem;
}
.sup__tot b {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-variant-numeric: tabular-nums;
}
.sup__sub {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.sup__actions {
  display: flex;
  align-items: center;
}
@container (max-width: 640px) {
  .sup {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .sup__stats {
    grid-row: 2;
  }
  .sup__actions {
    grid-row: 1 / span 2;
    grid-column: 2;
    flex-direction: column;
  }
  .reg__bar {
    flex-wrap: wrap;
  }
  .reg__search {
    max-width: none;
    flex: 1 1 100%;
  }
}
</style>
