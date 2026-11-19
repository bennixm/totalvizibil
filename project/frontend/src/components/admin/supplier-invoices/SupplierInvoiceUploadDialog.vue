<script setup lang="ts">
/**
 * Add an original supplier document. Optional "fill with AI": Claude reads
 * the document server-side and pre-fills the form with a confidence per
 * field. The person checks the values against the document; without the
 * "I checked" box the invoice is saved as "needs review". AI output is a
 * draft, never an accounting validation.
 */
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  useExternalInvoicesStore,
  type ExternalInvoiceProviderKey,
  type ExtractionResult,
  type VatLine,
} from '@/stores/externalInvoices'
import { useToastStore } from '@/stores/toast'

import { FILE_ACCEPT, MAX_FILE_BYTES, readDataUri, useInvoiceFormat } from './useInvoiceFormat'

const props = defineProps<{ modelValue: boolean; provider?: ExternalInvoiceProviderKey | null }>()
const emit = defineEmits<{ 'update:modelValue': [v: boolean]; saved: [id: string] }>()

const { t } = useI18n()
const store = useExternalInvoicesStore()
const toasts = useToastStore()
const fmt = useInvoiceFormat()

const CURRENCIES = ['EUR', 'RON', 'USD', 'GBP']
const KNOWN: { re: RegExp; key: ExternalInvoiceProviderKey }[] = [
  { re: /google/i, key: 'google_ads' },
  { re: /anthropic/i, key: 'anthropic' },
  { re: /deepseek/i, key: 'deepseek' },
  { re: /stripe/i, key: 'stripe' },
]

const form = reactive({
  provider: 'anthropic' as ExternalInvoiceProviderKey,
  providerName: '',
  invoiceNumber: '',
  supplierVatId: '',
  issueDate: '',
  dueDate: '',
  periodStart: '',
  periodEnd: '',
  currency: 'USD',
  subtotal: null as number | null,
  tax: null as number | null,
  total: null as number | null,
  paymentStatus: null as 'paid' | 'unpaid' | null,
  paidAt: '',
  note: '',
  vatLines: [] as VatLine[],
  linesCount: 0,
  file: null as File | null,
  reviewed: false,
})
const extraction = ref<ExtractionResult | null>(null)
const showExtra = ref(false)
const extraFilled = computed(() => !!(form.periodStart || form.periodEnd || form.note))
const extracting = ref(false)
const saving = ref(false)

function reset(): void {
  Object.assign(form, {
    provider: props.provider ?? 'anthropic',
    providerName: '',
    invoiceNumber: '',
    supplierVatId: '',
    issueDate: '',
    dueDate: '',
    periodStart: '',
    periodEnd: '',
    currency: props.provider === 'other' ? 'RON' : props.provider === 'google_ads' ? 'EUR' : 'USD',
    subtotal: null,
    tax: null,
    total: null,
    paymentStatus: null,
    paidAt: '',
    note: '',
    vatLines: [],
    linesCount: 0,
    file: null,
    reviewed: false,
  })
  extraction.value = null
  showExtra.value = false
}
watch(
  () => props.modelValue,
  (v) => {
    if (v) reset()
  },
)

const show = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const PROVIDERS = computed(() =>
  store.providers.map((p) => ({ value: p.key, title: p.key === 'other' ? t('supplierInvoices.providerOther') : p.name })),
)
const PAYMENT_ITEMS = computed(() => [
  { value: 'paid', title: t('supplierInvoices.statusPaid') },
  { value: 'unpaid', title: t('supplierInvoices.statusUnpaid') },
])

const fileError = computed(() =>
  form.file && form.file.size > MAX_FILE_BYTES ? t('supplierInvoices.err.attachment_too_large') : '',
)
const isXml = computed(() => !!form.file && /\.xml$/i.test(form.file.name))

function onFile(v: File | File[] | null): void {
  form.file = Array.isArray(v) ? (v[0] ?? null) : v
  extraction.value = null
}

/** Low-confidence groups, to highlight the matching fields. */
const low = computed(() => {
  const c = extraction.value?.extraction.fieldConfidence ?? {}
  const isLow = (k: string) => typeof c[k] === 'number' && c[k] < 0.8
  return {
    supplier: isLow('supplier_name'),
    number: isLow('invoice_number'),
    issue: isLow('issue_date'),
    due: isLow('due_date'),
    currency: isLow('currency'),
    amounts: isLow('amounts'),
    vat: isLow('vat'),
  }
})

async function runExtraction(): Promise<void> {
  if (!form.file || fileError.value) return
  extracting.value = true
  try {
    const res = await store.extract(await readDataUri(form.file), form.file.name)
    extraction.value = res
    const d = res.draft
    const known = KNOWN.find((k) => d.supplierName && k.re.test(d.supplierName))
    form.provider = known?.key ?? 'other'
    form.providerName = known ? '' : (d.supplierName ?? '')
    form.invoiceNumber = d.invoiceNumber ?? ''
    form.supplierVatId = d.supplierVatId ?? ''
    form.issueDate = d.issueDate ?? ''
    form.dueDate = d.dueDate ?? ''
    form.periodStart = d.periodStart ?? ''
    form.periodEnd = d.periodEnd ?? ''
    if (d.currency) form.currency = d.currency
    form.subtotal = d.subtotalMinor !== null ? d.subtotalMinor / 100 : null
    form.tax = d.taxMinor !== null ? d.taxMinor / 100 : null
    form.total = d.totalMinor !== null ? d.totalMinor / 100 : null
    form.paymentStatus = d.paymentStatus
    form.vatLines = d.vatLines
    form.linesCount = d.lines.length
    form.reviewed = false
    if (form.periodStart || form.periodEnd) showExtra.value = true
  } catch (e) {
    toasts.error(fmt.errText(e))
  } finally {
    extracting.value = false
  }
}

const num = (v: number | null) => (v === null || v === undefined || String(v) === '' ? null : Math.round(Number(v) * 100))

const canSave = computed(
  () =>
    !!form.file &&
    !fileError.value &&
    form.invoiceNumber.trim().length > 0 &&
    form.issueDate.length === 10 &&
    num(form.total) !== null &&
    (num(form.total) ?? -1) >= 0 &&
    (form.provider !== 'other' || form.providerName.trim().length > 0) &&
    (!form.periodStart || !form.periodEnd || form.periodStart <= form.periodEnd),
)

async function save(): Promise<void> {
  if (!canSave.value || !form.file) return
  saving.value = true
  try {
    const ex = extraction.value
    const res = await store.upload({
      provider: form.provider,
      ...(form.provider === 'other' ? { providerName: form.providerName.trim() } : {}),
      invoiceNumber: form.invoiceNumber.trim(),
      ...(form.supplierVatId.trim() ? { supplierVatId: form.supplierVatId.trim() } : {}),
      issueDate: form.issueDate,
      ...(form.dueDate ? { dueDate: form.dueDate } : {}),
      ...(form.periodStart ? { periodStart: form.periodStart } : {}),
      ...(form.periodEnd ? { periodEnd: form.periodEnd } : {}),
      currency: form.currency,
      ...(num(form.subtotal) !== null ? { subtotalMinor: num(form.subtotal) as number } : {}),
      ...(num(form.tax) !== null ? { taxMinor: num(form.tax) as number } : {}),
      totalMinor: num(form.total) as number,
      ...(form.vatLines.length ? { vatLines: form.vatLines } : {}),
      ...(ex?.draft.lines.length ? { lines: ex.draft.lines } : {}),
      ...(form.paymentStatus ? { paymentStatus: form.paymentStatus } : {}),
      ...(form.paymentStatus === 'paid' && form.paidAt ? { paidAt: form.paidAt } : {}),
      ...(form.note.trim() ? { note: form.note.trim() } : {}),
      ...(ex
        ? {
            extraction: {
              engine: ex.extraction.engine,
              model: ex.extraction.model,
              confidence: ex.extraction.confidence,
              fieldConfidence: ex.extraction.fieldConfidence,
              estimatedCostUsd: ex.extraction.estimatedCostUsd,
            },
            reviewed: form.reviewed,
          }
        : {}),
      dataUri: await readDataUri(form.file),
      filename: form.file.name,
    })
    show.value = false
    toasts.success(
      res.possibleDuplicateOfId ? t('supplierInvoices.uploadedDuplicate') : t('supplierInvoices.uploaded'),
    )
    emit('saved', res.id)
  } catch (e) {
    toasts.error(fmt.errText(e))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog v-model="show" max-width="640" scrollable>
    <v-card rounded="lg">
      <v-card-title class="sud__title">{{ t('supplierInvoices.addOriginal') }}</v-card-title>
      <v-card-text class="sud">
        <p class="sud__hint">{{ t('supplierInvoices.uploadHint') }}</p>

        <!-- 1. The document -->
        <div class="sud__file">
          <v-file-input
            :model-value="form.file"
            :accept="FILE_ACCEPT"
            :label="t('supplierInvoices.fileLabel')"
            :hint="t('supplierInvoices.fileHint')"
            :error-messages="fileError"
            persistent-hint
            prepend-icon=""
            prepend-inner-icon="mdi-paperclip"
            density="comfortable"
            @update:model-value="onFile"
          />
          <v-btn
            color="primary"
            variant="tonal"
            prepend-icon="mdi-creation-outline"
            :loading="extracting"
            :disabled="!form.file || !!fileError"
            class="sud__ai"
            @click="runExtraction"
          >
            {{ isXml ? t('supplierInvoices.xmlFill') : t('supplierInvoices.aiFill') }}
          </v-btn>
        </div>
        <p v-if="isXml" class="sud__note">{{ t('supplierInvoices.xmlHint') }}</p>

        <v-alert
          v-if="extraction"
          :type="extraction.extraction.lowConfidence || extraction.issues.length ? 'warning' : 'info'"
          variant="tonal"
          density="compact"
          class="sud__alert"
        >
          <div v-if="extraction.extraction.engine === 'xml'">
            {{ t('supplierInvoices.xmlDone', { format: extraction.extraction.model }) }}
          </div>
          <div v-else>
            {{
              t('supplierInvoices.aiDone', {
                pct: Math.round(extraction.extraction.confidence * 100),
              })
            }}
          </div>
          <div v-if="extraction.issues.length" class="sud__issues">
            {{ extraction.issues.map((i) => t(`supplierInvoices.issue.${i}`)).join(' · ') }}
          </div>
          <div v-if="extraction.extraction.engine !== 'xml'" class="sud__disclaimer">{{ t('supplierInvoices.aiDisclaimer') }}</div>
        </v-alert>

        <!-- 2. The data, as printed on the document -->
        <div class="sud__grid">
          <v-select
            v-model="form.provider"
            :items="PROVIDERS"
            :label="t('supplierInvoices.colProvider')"
            density="comfortable"
            :class="{ 'is-low': low.supplier }"
          />
          <v-text-field
            v-if="form.provider === 'other'"
            v-model="form.providerName"
            :label="t('supplierInvoices.providerName')"
            maxlength="120"
            density="comfortable"
            :class="{ 'is-low': low.supplier }"
          />
          <v-text-field
            v-model="form.invoiceNumber"
            :label="t('supplierInvoices.colNumber')"
            maxlength="80"
            density="comfortable"
            :class="{ 'is-low': low.number }"
          />
          <v-text-field
            v-model="form.supplierVatId"
            :label="t('supplierInvoices.vatId')"
            maxlength="40"
            density="comfortable"
          />
          <v-text-field
            v-model="form.issueDate"
            type="date"
            :label="t('supplierInvoices.colIssued')"
            density="comfortable"
            :class="{ 'is-low': low.issue }"
          />
          <v-text-field
            v-model="form.dueDate"
            type="date"
            :label="t('supplierInvoices.colDue')"
            density="comfortable"
            :class="{ 'is-low': low.due }"
          />
        </div>

        <div class="sud__money">
          <v-text-field
            v-model.number="form.subtotal"
            type="number"
            min="0"
            step="0.01"
            :label="t('supplierInvoices.colNet')"
            density="comfortable"
            :class="{ 'is-low': low.amounts }"
          />
          <v-text-field
            v-model.number="form.tax"
            type="number"
            min="0"
            step="0.01"
            :label="t('supplierInvoices.colVat')"
            density="comfortable"
            :class="{ 'is-low': low.vat }"
          />
          <v-text-field
            v-model.number="form.total"
            type="number"
            min="0"
            step="0.01"
            :label="t('supplierInvoices.totalLabel')"
            density="comfortable"
            :class="{ 'is-low': low.amounts }"
          />
          <v-select
            v-model="form.currency"
            :items="CURRENCIES"
            :label="t('supplierInvoices.currency')"
            density="comfortable"
            :class="{ 'is-low': low.currency }"
          />
        </div>
        <p v-if="form.vatLines.length || form.linesCount" class="sud__note">
          <template v-if="form.vatLines.length">
            {{ t('supplierInvoices.vatLinesFound') }}:
            {{ form.vatLines.map((v) => `${v.rate ?? '?'}% ${fmt.amount(v.vatMinor, form.currency)}`).join(' · ') }}.
          </template>
          <template v-if="form.linesCount">{{ t('supplierInvoices.linesFound', { n: form.linesCount }) }}</template>
        </p>

        <div class="sud__grid">
          <v-select
            v-model="form.paymentStatus"
            :items="PAYMENT_ITEMS"
            :label="t('supplierInvoices.colPayment')"
            clearable
            density="comfortable"
          />
          <v-text-field
            v-if="form.paymentStatus === 'paid'"
            v-model="form.paidAt"
            type="date"
            :label="t('supplierInvoices.paidAt')"
            :hint="t('supplierInvoices.paidAtHint')"
            persistent-hint
            density="comfortable"
          />
        </div>
        <!-- Secondary fields: folded until needed (opened automatically when
             the AI/XML read filled them in). -->
        <button type="button" class="sud__more" :aria-expanded="showExtra" @click="showExtra = !showExtra">
          <v-icon :icon="showExtra ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="16" />
          {{ t('supplierInvoices.moreDetails') }}
          <span v-if="!showExtra && extraFilled" class="sud__more-hint">{{ t('supplierInvoices.filledIn') }}</span>
        </button>
        <div v-if="showExtra" class="sud__extra">
          <div class="sud__grid">
            <v-text-field v-model="form.periodStart" type="date" :label="t('supplierInvoices.periodStart')" density="comfortable" />
            <v-text-field v-model="form.periodEnd" type="date" :label="t('supplierInvoices.periodEnd')" density="comfortable" />
          </div>
          <v-text-field v-model="form.note" :label="t('supplierInvoices.note')" maxlength="300" density="comfortable" />
        </div>

        <v-checkbox
          v-if="extraction && extraction.extraction.engine !== 'xml'"
          v-model="form.reviewed"
          :label="t('supplierInvoices.reviewedLabel')"
          density="compact"
          hide-details
          color="primary"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="show = false">{{ t('common.cancel') }}</v-btn>
        <v-btn color="primary" variant="flat" :loading="saving" :disabled="!canSave" @click="save">
          {{ t('common.save') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.sud {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.sud__title {
  padding-bottom: 0.25rem;
}
.sud__hint {
  margin: 0 0 0.5rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.sud__file {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.6rem;
  align-items: start;
}
.sud__ai {
  margin-top: 0.35rem;
}
.sud__alert {
  margin: 0.25rem 0 0.6rem;
  font-size: var(--tvz-fs-small);
}
.sud__issues {
  margin-top: 0.2rem;
  font-weight: 600;
}
.sud__disclaimer {
  margin-top: 0.2rem;
  font-size: var(--tvz-fs-caption);
  opacity: 0.85;
}
.sud__note {
  margin: -0.4rem 0 0.6rem;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.sud__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 0.6rem;
}
.sud__more {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  align-self: flex-start;
  margin: 0 0 0.6rem;
  padding: 0;
  border: 0;
  background: none;
  color: rgb(var(--v-theme-primary));
  font: inherit;
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  cursor: pointer;
}
.sud__more-hint {
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.sud__money {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) 6.5rem;
  gap: 0 0.6rem;
}
/* Fields the AI was unsure about: amber outline + label, not just colour. */
.is-low :deep(.v-field__outline) {
  color: rgb(var(--v-theme-warning)) !important;
  --v-field-border-opacity: 0.9;
}
.is-low :deep(.v-label) {
  color: rgb(var(--v-theme-warning));
}

@media (max-width: 560px) {
  .sud__file,
  .sud__grid {
    grid-template-columns: 1fr;
  }
  .sud__ai {
    margin-top: 0;
  }
  .sud__money {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
