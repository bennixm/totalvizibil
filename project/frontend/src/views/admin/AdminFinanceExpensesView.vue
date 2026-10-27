<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminPager from '@/components/admin/AdminPager.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import {
  useAdminFinanceStore,
  type ExpenseCategory,
  type ExpenseCurrency,
  type ExpenseRow,
} from '@/stores/adminFinance'
import { useAuthStore } from '@/stores/auth'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { ApiError } from '@/services/api'

const { t } = useI18n()
const finance = useAdminFinanceStore()
const auth = useAuthStore()
const confirm = useConfirmStore()
const toasts = useToastStore()

/** `stripe_api` rows are auto-captured Stripe-fee bookkeeping: editing or
 *  deleting one breaks reconciliation against Stripe's own payout report, so
 *  the backend only lets a full `admin` touch them (403
 *  `stripe_expense_readonly`). Mirrored here so a Contabil sees WHY the
 *  actions are unavailable instead of discovering it as a failed request. */
const isPlatformAdmin = computed(() => auth.user?.platformRoles.includes('admin') ?? false)
function isLocked(row: ExpenseRow): boolean {
  return row.source === 'stripe_api' && !isPlatformAdmin.value
}
const LOCKED_HINT =
  'Înregistrare automată din Stripe — se poate modifica doar de un administrator, pentru ca reconcilierea cu Stripe să rămână validă.'
function errText(e: unknown, fb: string): string {
  return e instanceof ApiError ? e.message : fb
}

/** Mirrors the server's `@Min(1) @Max(100_000_000)` on `amountMinor` — keeps
 *  an invalid amount from ever leaving the client as a confusing raw 400. */
const MIN_AMOUNT_MINOR = 1
const MAX_AMOUNT_MINOR = 100_000_000

/** Local calendar date, NOT `toISOString().slice(0,10)` — that reads UTC,
 *  so an entry made between midnight and ~2-3am local time (Romania is
 *  UTC+2/+3) would silently default to YESTERDAY's date. */
function localDateStr(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'hosting', label: 'Hosting' },
  { value: 'call_center', label: 'Centrală apeluri' },
  { value: 'cloud_storage', label: 'Stocare cloud' },
  { value: 'domains', label: 'Domenii' },
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'stripe_fees', label: 'Comision Stripe' },
  { value: 'other', label: 'Altele' },
]
function categoryLabel(c: ExpenseCategory): string {
  return CATEGORIES.find((x) => x.value === c)?.label ?? c
}
const CURRENCIES: ExpenseCurrency[] = ['EUR', 'RON', 'USD']
const CURRENCY_SUFFIX: Record<string, string> = { EUR: '€', RON: 'lei', USD: '$' }

/** An expense recorded in a foreign currency keeps the ORIGINAL document's
 *  currency; the platform reports still treat the minor amount as EUR cents,
 *  so the row shows what was actually entered. */
function amount(minor: number, currency: string): string {
  const value = (minor / 100).toLocaleString('ro-RO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${value} ${CURRENCY_SUFFIX[currency] ?? currency}`
}
function dt(s: string): string {
  return new Date(s).toLocaleDateString('ro-RO')
}

const hasRows = computed(() => finance.expenses.length > 0)

const editor = reactive({
  show: false,
  id: null as string | null,
  category: 'hosting' as ExpenseCategory,
  incurredOn: localDateStr(),
  amount: 0,
  currency: 'EUR' as ExpenseCurrency,
  note: '',
})
const busy = reactive({ save: false, deleteId: null as string | null })

function openCreate(): void {
  editor.id = null
  editor.category = 'hosting'
  editor.incurredOn = localDateStr()
  editor.amount = 0
  editor.currency = 'EUR'
  editor.note = ''
  editor.show = true
}
function openEdit(row: ExpenseRow): void {
  if (isLocked(row)) return
  editor.id = row.id
  editor.category = row.category
  editor.incurredOn = row.incurredOn.slice(0, 10)
  editor.amount = row.amountMinor / 100
  editor.currency = (CURRENCIES.find((c) => c === row.currency) ?? 'EUR') as ExpenseCurrency
  editor.note = row.note ?? ''
  editor.show = true
}
const amountMinor = computed(() => Math.round(editor.amount * 100))
const canSave = computed(
  () =>
    amountMinor.value >= MIN_AMOUNT_MINOR &&
    amountMinor.value <= MAX_AMOUNT_MINOR &&
    editor.incurredOn.length === 10 &&
    new Date(editor.incurredOn).getTime() <= Date.now(),
)

async function save(): Promise<void> {
  if (!canSave.value) return
  busy.save = true
  try {
    const payload = {
      category: editor.category,
      incurredOn: editor.incurredOn,
      amountMinor: amountMinor.value,
      currency: editor.currency,
      note: editor.note.trim() || undefined,
    }
    if (editor.id) await finance.updateExpense(editor.id, payload)
    else await finance.createExpense(payload)
    editor.show = false
  } catch (e) {
    toasts.error(errText(e, t('admin.genericError')))
  } finally {
    busy.save = false
  }
}
function confirmRemove(row: ExpenseRow): void {
  if (isLocked(row)) return
  confirm.ask(t('adminFinance.deleteExpenseTitle'), t('adminFinance.deleteExpenseConfirm'), () => remove(row.id))
}
async function remove(id: string): Promise<void> {
  busy.deleteId = id
  try {
    await finance.deleteExpense(id)
  } catch (e) {
    toasts.error(errText(e, t('admin.genericError')))
  } finally {
    busy.deleteId = null
  }
}

onMounted(() => finance.fetchExpenses())
</script>

<template>
  <div class="afe">
    <AdminPageHeader :title="t('adminFinance.expensesTitle')" :eyebrow="t('admin.navGroupFinance')" :count="finance.expensesTotal" :sub="t('adminFinance.expensesLead')">
      <template #actions>
        <v-btn v-if="hasRows" :href="finance.expensesExportUrl()" variant="tonal" size="small" prepend-icon="mdi-file-pdf-box">
          {{ t('transactions.exportPdf') }}
        </v-btn>
        <v-btn color="primary" variant="flat" size="small" prepend-icon="mdi-plus" @click="openCreate">
          {{ t('adminFinance.addExpense') }}
        </v-btn>
      </template>
    </AdminPageHeader>

    <div class="afe__filters">
      <v-select
        :model-value="finance.expenseFilters.category"
        :items="[{ value: null, label: t('adminFinance.allCategories') }, ...CATEGORIES.map((c) => ({ value: c.value, label: c.label }))]"
        item-title="label"
        item-value="value"
        :label="t('adminFinance.category')"
        density="compact"
        hide-details
        style="max-width: 220px"
        @update:model-value="finance.setExpenseFilter('category', $event)"
      />
    </div>

    <div v-if="finance.loadingExpenses && !hasRows" class="afe__center">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <AdminEmptyState v-else-if="!hasRows" icon="mdi-cash-minus" :text="t('adminFinance.noExpenses')" />

    <div v-else class="rtable">
      <div class="rtable__head" aria-hidden="true">
        <span>{{ t('adminFinance.colDate') }}</span>
        <span>{{ t('adminFinance.category') }}</span>
        <span>{{ t('adminFinance.colSource') }}</span>
        <span>{{ t('adminFinance.colNote') }}</span>
        <span>{{ t('adminFinance.colAmount') }}</span>
        <span></span>
      </div>

      <ul class="afe__list">
        <li v-for="r in finance.expenses" :key="r.id" class="rrow">
          <span class="rrow__cell">{{ dt(r.incurredOn) }}</span>
          <span class="rrow__cell">{{ categoryLabel(r.category) }}</span>
          <span class="rrow__cell">
            <span class="chip" :class="r.source === 'stripe_api' ? 'chip--auto' : 'chip--manual'">
              {{ r.source === 'stripe_api' ? t('adminFinance.automatic') : t('adminFinance.manual') }}
            </span>
          </span>
          <span class="rrow__cell afe__note">{{ r.note ?? '—' }}</span>
          <span class="rrow__cell"><b>{{ amount(r.amountMinor, r.currency) }}</b></span>
          <span class="afe__actions">
            <v-tooltip v-if="isLocked(r)" :text="LOCKED_HINT" location="top">
              <template #activator="{ props: tip }">
                <span v-bind="tip" class="afe__lock">
                  <v-icon icon="mdi-lock-outline" size="18" />
                </span>
              </template>
            </v-tooltip>
            <template v-else>
              <v-btn icon="mdi-pencil-outline" variant="text" size="small" @click="openEdit(r)" />
              <v-btn
                icon="mdi-trash-can-outline"
                variant="text"
                size="small"
                color="error"
                :loading="busy.deleteId === r.id"
                @click="confirmRemove(r)"
              />
            </template>
          </span>
        </li>
      </ul>
    </div>

    <AdminPager
      :page="finance.expenseFilters.page"
      :page-size="finance.expenseFilters.pageSize"
      :total="finance.expensesTotal"
      @update:page="finance.setExpenseFilter('page', $event)"
    />

    <v-dialog v-model="editor.show" max-width="480">
      <v-card rounded="lg">
        <v-card-title>{{ editor.id ? t('adminFinance.editExpense') : t('adminFinance.addExpense') }}</v-card-title>
        <v-card-text class="d-flex flex-column ga-1">
          <v-select v-model="editor.category" :items="CATEGORIES" item-title="label" item-value="value" :label="t('adminFinance.category')" density="comfortable" />
          <v-text-field v-model="editor.incurredOn" type="date" :label="t('adminFinance.colDate')" density="comfortable" />
          <div class="afe__amountrow">
            <v-text-field
              v-model.number="editor.amount"
              type="number"
              min="0"
              step="0.01"
              :suffix="CURRENCY_SUFFIX[editor.currency]"
              :label="t('adminFinance.colAmount')"
              density="comfortable"
            />
            <v-select
              v-model="editor.currency"
              :items="CURRENCIES"
              label="Monedă"
              density="comfortable"
              style="max-width: 120px"
            />
          </div>
          <v-text-field v-model="editor.note" :label="t('adminFinance.colNote')" density="comfortable" maxlength="300" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="editor.show = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :loading="busy.save" :disabled="!canSave" @click="save">
            {{ t('common.save') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.afe {
  max-width: 1100px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.afe__filters {
  margin: 1.2rem 0 1.2rem;
}
.afe__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.afe__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.afe__note {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.afe__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.1rem;
}
.afe__lock {
  display: inline-flex;
  padding: 0.35rem;
  color: rgba(var(--v-theme-on-surface), 0.38);
  cursor: help;
}
.afe__amountrow {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
}
.afe__amountrow > :first-child {
  flex: 1 1 auto;
}

.rtable {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  overflow: hidden;
}
.rtable__head,
.rrow {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 0.9fr) minmax(0, 0.8fr) minmax(0, 1.2fr) minmax(0, 0.7fr) minmax(0, 0.6fr);
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
  padding: 0.6rem 1.1rem;
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
.chip {
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.12rem 0.4rem;
  border-radius: 4px;
}
.chip--manual {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.chip--auto {
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}

@media (max-width: 860px) {
  .rtable__head {
    display: none;
  }
  .rrow {
    grid-template-columns: 1fr 1fr;
    row-gap: 0.4rem;
  }
  .afe__actions {
    grid-column: span 2;
    justify-content: flex-start;
    border-top: 1px dashed var(--tvz-hairline);
    padding-top: 0.3rem;
  }
}
</style>
