<script setup lang="ts">
/**
 * VAT on supplier invoices, per month and currency. Two separate columns:
 * the ESTIMATE the platform calculates from stored invoices, and the figure
 * the ACCOUNTANT confirmed (entered here, kept in its own table). The
 * estimate is never presented as the tax obligation.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useConfirmStore } from '@/stores/confirm'
import { useExternalInvoicesStore, type VatPeriod } from '@/stores/externalInvoices'
import { useToastStore } from '@/stores/toast'

import { useInvoiceFormat } from './useInvoiceFormat'

const { t } = useI18n()
const store = useExternalInvoicesStore()
const confirm = useConfirmStore()
const toasts = useToastStore()
const fmt = useInvoiceFormat()

const year = ref(new Date().getUTCFullYear())
const years = ref<number[]>([])
const periods = ref<VatPeriod[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await store.fetchVatReport(year.value)
    periods.value = r.periods
    years.value = [...new Set([new Date().getUTCFullYear(), ...r.years])].sort((a, b) => b - a)
    error.value = null
  } catch (e) {
    error.value = fmt.errText(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(year, load)

const totals = computed(() => {
  const m = new Map<string, { est: number; estKnown: boolean; conf: number; confirmedPeriods: number; periods: number }>()
  for (const p of periods.value) {
    const c = m.get(p.currency) ?? { est: 0, estKnown: false, conf: 0, confirmedPeriods: 0, periods: 0 }
    c.est += p.estimated.vatMinor ?? 0
    if (p.estimated.vatMinor !== null) c.estKnown = true
    c.periods++
    if (p.confirmed) {
      c.conf += p.confirmed.vatMinor
      c.confirmedPeriods++
    }
    m.set(p.currency, c)
  }
  return [...m.entries()]
})

function periodLabel(p: string): string {
  return fmt.monthName(Number(p.slice(5, 7)), Number(p.slice(0, 4)))
}

const dlg = reactive({ open: false, period: '', currency: '', amount: null as number | null, note: '', busy: false, estimate: 0 })
function openConfirm(p: VatPeriod): void {
  Object.assign(dlg, {
    open: true,
    period: p.period,
    currency: p.currency,
    amount: p.confirmed ? p.confirmed.vatMinor / 100 : null,
    note: p.confirmed?.note ?? '',
    busy: false,
    estimate: p.estimated.vatMinor ?? 0,
  })
}
async function saveConfirm(): Promise<void> {
  if (dlg.amount === null || String(dlg.amount) === '' || Number(dlg.amount) < 0) return
  dlg.busy = true
  try {
    await store.confirmVat({
      period: dlg.period,
      currency: dlg.currency,
      confirmedVatMinor: Math.round(Number(dlg.amount) * 100),
      ...(dlg.note.trim() ? { note: dlg.note.trim() } : {}),
    })
    dlg.open = false
    toasts.success(t('supplierInvoices.vatConfirmed'))
    await load()
  } catch (e) {
    toasts.error(fmt.errText(e))
  } finally {
    dlg.busy = false
  }
}
function removeConfirm(p: VatPeriod): void {
  confirm.ask(t('supplierInvoices.vatUnconfirmTitle'), t('supplierInvoices.vatUnconfirmText', { period: periodLabel(p.period) }), async () => {
    try {
      await store.unconfirmVat(p.period, p.currency)
      await load()
    } catch (e) {
      toasts.error(fmt.errText(e))
    }
  })
}
</script>

<template>
  <section class="vat">
    <div class="vat__bar">
      <v-select v-model="year" :items="years" :label="t('supplierInvoices.yearLabel')" density="compact" variant="outlined" hide-details class="vat__year" />
      <v-progress-circular v-if="loading" indeterminate size="16" width="2" />
    </div>
    <v-alert type="info" variant="tonal" density="compact" class="vat__note">
      {{ t('supplierInvoices.vatDisclaimer') }}
    </v-alert>

    <div v-if="totals.length" class="vat__totals">
      <div v-for="[cur, x] in totals" :key="cur" class="vt">
        <span class="vt__cur">{{ cur }} · {{ year }}</span>
        <span class="vt__row"><span>{{ t('supplierInvoices.vatEstimated') }}</span><b>{{ x.estKnown ? fmt.amount(x.est, cur) : '-' }}</b></span>
        <span class="vt__row">
          <span>{{ t('supplierInvoices.vatConfirmedCol') }} ({{ x.confirmedPeriods }}/{{ x.periods }})</span>
          <b>{{ x.confirmedPeriods ? fmt.amount(x.conf, cur) : '-' }}</b>
        </span>
      </div>
    </div>

    <p v-if="error" class="vat__error">{{ error }}</p>
    <v-skeleton-loader v-else-if="loading && !periods.length" type="table-row-divider@4" />
    <div v-else-if="!periods.length" class="vat__empty">{{ t('supplierInvoices.vatEmpty') }}</div>

    <div v-else class="vtbl">
      <div class="vtbl__head">
        <span>{{ t('supplierInvoices.period') }}</span>
        <span class="num">{{ t('supplierInvoices.colNet') }}</span>
        <span>{{ t('supplierInvoices.vatByRate') }}</span>
        <span class="num">{{ t('supplierInvoices.vatEstimated') }}</span>
        <span class="num">{{ t('supplierInvoices.vatConfirmedCol') }}</span>
        <span></span>
      </div>
      <div v-for="p in periods" :key="`${p.period}-${p.currency}`" class="vrow">
        <span class="vrow__period">
          <b>{{ periodLabel(p.period) }}</b>
          <small>
            {{ p.currency }} · {{ t('supplierInvoices.nInvoices', { n: p.invoices }) }}
            <template v-if="p.unverified"> · <span class="warn">{{ t('supplierInvoices.nUnverified', { n: p.unverified }) }}</span></template>
          </small>
        </span>
        <span class="num" :data-label="t('supplierInvoices.colNet')">{{ fmt.amount(p.estimated.netMinor, p.currency) }}</span>
        <span class="vrow__rates" :data-label="t('supplierInvoices.vatByRate')">
          <span v-for="r in p.estimated.byRate" :key="String(r.rate)">
            {{ r.rate === null ? t('supplierInvoices.rateUnknown') : `${r.rate}%` }}: {{ fmt.amount(r.vatMinor, p.currency) }}
          </span>
          <span v-if="!p.estimated.byRate.length">-</span>
        </span>
        <span class="num" :data-label="t('supplierInvoices.vatEstimated')">
          {{ fmt.amount(p.estimated.vatMinor, p.currency) }}
          <small v-if="p.estimated.vatMinor !== null" class="est">{{ t('supplierInvoices.estimate') }}</small>
          <small v-else>{{ t('supplierInvoices.vatNotStated') }}</small>
        </span>
        <span class="num" :data-label="t('supplierInvoices.vatConfirmedCol')">
          <template v-if="p.confirmed">
            <b class="ok">{{ fmt.amount(p.confirmed.vatMinor, p.currency) }}</b>
            <small v-if="p.differenceMinor" :class="p.differenceMinor ? 'warn' : ''">
              {{ t('supplierInvoices.vatDiff', { amount: fmt.amount(p.differenceMinor, p.currency) }) }}
            </small>
            <small v-if="p.confirmed.by">{{ p.confirmed.by }}</small>
          </template>
          <span v-else class="muted">{{ t('supplierInvoices.notConfirmed') }}</span>
        </span>
        <span class="vrow__act">
          <v-btn size="small" variant="text" :prepend-icon="p.confirmed ? 'mdi-pencil-outline' : 'mdi-check-decagram-outline'" @click="openConfirm(p)">
            {{ p.confirmed ? t('supplierInvoices.edit') : t('supplierInvoices.confirmVat') }}
          </v-btn>
          <v-btn v-if="p.confirmed" size="small" variant="text" color="error" icon="mdi-close" :aria-label="t('supplierInvoices.delete')" @click="removeConfirm(p)" />
        </span>
      </div>
    </div>

    <v-dialog v-model="dlg.open" max-width="440">
      <v-card rounded="lg">
        <v-card-title>{{ t('supplierInvoices.confirmVatTitle', { period: dlg.period ? periodLabel(dlg.period) : '', cur: dlg.currency }) }}</v-card-title>
        <v-card-text class="d-flex flex-column ga-1">
          <p class="dlg__hint">
            {{ t('supplierInvoices.confirmVatHint', { amount: fmt.amount(dlg.estimate, dlg.currency) }) }}
          </p>
          <v-text-field
            v-model.number="dlg.amount"
            type="number"
            min="0"
            step="0.01"
            :label="t('supplierInvoices.vatConfirmedCol')"
            :suffix="dlg.currency"
            density="comfortable"
          />
          <v-text-field v-model="dlg.note" :label="t('supplierInvoices.note')" density="comfortable" maxlength="500" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dlg.open = false">{{ t('common.cancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :loading="dlg.busy" :disabled="dlg.amount === null || String(dlg.amount) === ''" @click="saveConfirm">
            {{ t('common.save') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.vat {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  container-type: inline-size;
}
.vat__bar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.vat__year {
  max-width: 10rem;
}
.vat__note {
  font-size: var(--tvz-fs-small);
}
.vat__totals {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: 0.6rem;
}
.vt {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
}
.vt__cur {
  font-size: var(--tvz-fs-caption);
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.vt__row {
  display: flex;
  justify-content: space-between;
  gap: 0.6rem;
  font-size: var(--tvz-fs-small);
}
.vt__row b {
  font-variant-numeric: tabular-nums;
}
.vat__error {
  color: rgb(var(--v-theme-error));
  font-size: var(--tvz-fs-small);
}
.vat__empty {
  padding: 2rem 1rem;
  border: 1px dashed var(--tvz-glass-border);
  border-radius: 12px;
  text-align: center;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.vtbl {
  border: 1px solid var(--tvz-glass-border);
  border-radius: 12px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}
.vtbl__head,
.vrow {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.9fr) minmax(0, 1.2fr) minmax(0, 0.9fr) minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.55rem 1rem;
}
.vtbl__head {
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.5);
  background: rgba(var(--v-theme-on-surface), 0.03);
  border-bottom: 1px solid var(--tvz-hairline);
}
.vrow {
  border-bottom: 1px solid var(--tvz-hairline);
  font-size: var(--tvz-fs-small);
}
.vrow:last-child {
  border-bottom: 0;
}
.vrow > span {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.vrow small {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.vrow__rates {
  font-size: var(--tvz-fs-caption);
}
.vrow__act {
  flex-direction: row !important;
  align-items: center;
}
.num {
  text-align: right;
  align-items: flex-end;
  font-variant-numeric: tabular-nums;
}
.est {
  text-transform: uppercase;
  font-size: var(--tvz-fs-micro) !important;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.ok {
  color: rgb(var(--v-theme-success));
}
.warn {
  color: rgb(var(--v-theme-warning)) !important;
}
.muted {
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.dlg__hint {
  margin: 0 0 0.6rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.65);
}

@container (max-width: 760px) {
  .vtbl__head {
    display: none;
  }
  .vrow {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    row-gap: 0.45rem;
  }
  .vrow__period,
  .vrow__rates,
  .vrow__act {
    grid-column: 1 / -1;
  }
  .num {
    text-align: left;
    align-items: flex-start;
  }
  .vrow > span[data-label]::before {
    content: attr(data-label);
    font-size: var(--tvz-fs-micro);
    font-weight: 700;
    text-transform: uppercase;
    color: rgba(var(--v-theme-on-surface), 0.42);
  }
}
</style>
