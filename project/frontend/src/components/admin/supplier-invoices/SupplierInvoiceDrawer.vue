<script setup lang="ts">
/**
 * One supplier invoice: the structured data next to its original document,
 * the change history, internal notes and extra files. "Edit" corrects any
 * field; every correction is kept in the history (from → to) and is never
 * overwritten by a later automatic re-import.
 */
import { computed, reactive, ref, watch } from 'vue'
import { useDisplay } from 'vuetify'
import { useI18n } from 'vue-i18n'

import { useConfirmStore } from '@/stores/confirm'
import {
  useExternalInvoicesStore,
  type ExternalInvoiceDetail,
  type InvoiceEvent,
  type VatLine,
} from '@/stores/externalInvoices'
import { useToastStore } from '@/stores/toast'

import InvoiceBadge from './InvoiceBadge.vue'
import { FILE_ACCEPT, MAX_FILE_BYTES, readDataUri, useInvoiceFormat } from './useInvoiceFormat'

const props = defineProps<{ invoiceId: string | null }>()
const emit = defineEmits<{ close: []; open: [id: string] }>()

const { t } = useI18n()
const { smAndDown } = useDisplay()
const store = useExternalInvoicesStore()
const confirm = useConfirmStore()
const toasts = useToastStore()
const fmt = useInvoiceFormat()

const inv = ref<ExternalInvoiceDetail | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)
const tab = ref<'details' | 'document' | 'history' | 'files'>('details')
const editing = ref(false)
const busy = ref<string | null>(null)
/** Text of an XML original, loaded when its tab is first opened. */
const xmlText = ref<string | null>(null)

const open = computed({
  get: () => !!props.invoiceId,
  set: (v: boolean) => {
    if (!v) emit('close')
  },
})

async function load(id: string): Promise<void> {
  loading.value = true
  loadError.value = null
  try {
    inv.value = await store.fetchDetail(id)
  } catch (e) {
    loadError.value = fmt.errText(e)
  } finally {
    loading.value = false
  }
}
watch(
  () => props.invoiceId,
  (id) => {
    editing.value = false
    xmlText.value = null
    if (id) {
      tab.value = 'details'
      void load(id)
    } else inv.value = null
  },
  { immediate: true },
)

const pay = computed(() => (inv.value ? fmt.payment(inv.value) : null))
const proc = computed(() => (inv.value ? fmt.processing(inv.value) : null))

// --- edit ---------------------------------------------------------------------
const CURRENCIES = ['EUR', 'RON', 'USD', 'GBP']
const ed = reactive({
  providerName: '',
  invoiceNumber: '',
  supplierVatId: '',
  issueDate: '',
  dueDate: '',
  periodStart: '',
  periodEnd: '',
  currency: 'EUR',
  subtotal: null as number | null,
  tax: null as number | null,
  total: null as number | null,
  paymentStatus: null as 'paid' | 'unpaid' | null,
  paidAt: '',
  note: '',
  vatLines: [] as { rate: number | null; net: number | null; vat: number | null }[],
})
const d10 = (s: string | null | undefined) => (s ? s.slice(0, 10) : '')
const maj = (m: number | null) => (m === null ? null : m / 100)
const min = (v: number | null | string) =>
  v === null || v === undefined || String(v) === '' ? null : Math.round(Number(v) * 100)

function startEdit(): void {
  const i = inv.value
  if (!i) return
  Object.assign(ed, {
    providerName: i.provider === 'other' ? i.providerName : '',
    invoiceNumber: i.invoiceNumber ?? '',
    supplierVatId: i.supplierVatId ?? '',
    issueDate: d10(i.issueDate),
    dueDate: d10(i.dueDate),
    periodStart: d10(i.periodStart),
    periodEnd: d10(i.periodEnd),
    currency: i.currency,
    subtotal: maj(i.subtotalMinor),
    tax: maj(i.taxMinor),
    total: maj(i.totalMinor),
    paymentStatus: i.paymentStatus,
    paidAt: d10(i.paidAt),
    note: i.note ?? '',
    vatLines: i.vatLines.map((v) => ({ rate: v.rate, net: maj(v.netMinor), vat: maj(v.vatMinor) })),
  })
  tab.value = 'details'
  editing.value = true
}

/** Only the fields that actually changed go to the server (and history). */
const patch = computed(() => {
  const i = inv.value
  if (!i) return {}
  const p: Record<string, unknown> = {}
  const set = (k: string, next: unknown, prev: unknown) => {
    if (JSON.stringify(next ?? null) !== JSON.stringify(prev ?? null)) p[k] = next
  }
  if (i.provider === 'other') set('providerName', ed.providerName.trim(), i.providerName)
  set('invoiceNumber', ed.invoiceNumber.trim(), i.invoiceNumber)
  set('supplierVatId', ed.supplierVatId.trim() || null, i.supplierVatId)
  set('issueDate', ed.issueDate, d10(i.issueDate))
  set('dueDate', ed.dueDate || null, d10(i.dueDate) || null)
  set('periodStart', ed.periodStart || null, d10(i.periodStart) || null)
  set('periodEnd', ed.periodEnd || null, d10(i.periodEnd) || null)
  set('currency', ed.currency, i.currency)
  set('subtotalMinor', min(ed.subtotal), i.subtotalMinor)
  set('taxMinor', min(ed.tax), i.taxMinor)
  set('totalMinor', min(ed.total), i.totalMinor)
  set('paymentStatus', ed.paymentStatus, i.paymentStatus)
  if (ed.paymentStatus === 'paid') set('paidAt', ed.paidAt || null, d10(i.paidAt) || null)
  set('note', ed.note.trim() || null, i.note)
  const vl: VatLine[] = ed.vatLines
    .filter((v) => v.net !== null || v.vat !== null)
    .map((v) => ({ rate: v.rate === null || String(v.rate) === '' ? null : Number(v.rate), netMinor: min(v.net) ?? 0, vatMinor: min(v.vat) ?? 0 }))
  set('vatLines', vl.length ? vl : null, i.vatLines.length ? i.vatLines : null)
  return p
})
const canSave = computed(
  () =>
    Object.keys(patch.value).length > 0 &&
    ed.invoiceNumber.trim().length > 0 &&
    ed.issueDate.length === 10 &&
    min(ed.total) !== null &&
    (inv.value?.provider !== 'other' || ed.providerName.trim().length > 0),
)

async function saveEdit(): Promise<void> {
  if (!inv.value || !canSave.value) return
  busy.value = 'save'
  try {
    inv.value = await store.update(inv.value.id, patch.value)
    editing.value = false
    toasts.success(t('supplierInvoices.saved'))
  } catch (e) {
    toasts.error(fmt.errText(e))
  } finally {
    busy.value = null
  }
}

async function quick(patchBody: Record<string, unknown>, tag: string, msg: string): Promise<void> {
  if (!inv.value) return
  busy.value = tag
  try {
    inv.value = await store.update(inv.value.id, patchBody)
    toasts.success(msg)
  } catch (e) {
    toasts.error(fmt.errText(e))
  } finally {
    busy.value = null
  }
}
function markPaid(): void {
  void quick({ paymentStatus: 'paid' }, 'paid', t('supplierInvoices.markedPaid'))
}
function markUnpaid(): void {
  void quick({ paymentStatus: 'unpaid' }, 'unpaid', t('supplierInvoices.markedUnpaid'))
}
function markVerified(): void {
  const i = inv.value
  if (!i) return
  const doIt = () => quick({ processingStatus: 'verified' }, 'verify', t('supplierInvoices.markedVerified'))
  if (i.issues.length || i.possibleDuplicateOfId) {
    confirm.ask(t('supplierInvoices.verifyAnywayTitle'), t('supplierInvoices.verifyAnywayText'), doIt)
  } else void doIt()
}

function remove(): void {
  const i = inv.value
  if (!i) return
  confirm.ask(t('supplierInvoices.deleteTitle'), t('supplierInvoices.deleteConfirm'), async () => {
    try {
      await store.remove(i.id)
      toasts.success(t('supplierInvoices.deleted'))
      emit('close')
    } catch (e) {
      toasts.error(fmt.errText(e))
    }
  })
}

// --- notes, attachments, XML preview ------------------------------------------
const noteText = ref('')
async function addNote(): Promise<void> {
  if (!inv.value || !noteText.value.trim()) return
  busy.value = 'note'
  try {
    await store.addNote(inv.value.id, noteText.value.trim())
    noteText.value = ''
    await load(inv.value.id)
  } catch (e) {
    toasts.error(fmt.errText(e))
  } finally {
    busy.value = null
  }
}

const fileInput = ref<HTMLInputElement | null>(null)
async function onAttach(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f || !inv.value) return
  if (f.size > MAX_FILE_BYTES) {
    toasts.error(t('supplierInvoices.err.attachment_too_large'))
    return
  }
  busy.value = 'attach'
  try {
    await store.addAttachment(inv.value.id, await readDataUri(f), f.name)
    await load(inv.value.id)
    toasts.success(t('supplierInvoices.attached'))
  } catch (e) {
    toasts.error(fmt.errText(e))
  } finally {
    busy.value = null
  }
}
function removeAttachment(attId: string, name: string): void {
  const i = inv.value
  if (!i) return
  confirm.ask(t('supplierInvoices.removeFileTitle'), t('supplierInvoices.removeFileText', { name }), async () => {
    try {
      await store.removeAttachment(i.id, attId)
      await load(i.id)
    } catch (e) {
      toasts.error(fmt.errText(e))
    }
  })
}

watch(tab, async (v) => {
  const i = inv.value
  if (v === 'document' && i?.document?.mime === 'application/xml' && xmlText.value === null) {
    try {
      const res = await fetch(store.documentUrl(i.id, true), { credentials: 'include' })
      xmlText.value = (await res.text()).slice(0, 200_000)
    } catch {
      xmlText.value = ''
    }
  }
})

// --- history labels -------------------------------------------------------------
const FIELD_KEYS: Record<string, string> = {
  providerName: 'supplierInvoices.providerName',
  invoiceNumber: 'supplierInvoices.colNumber',
  supplierVatId: 'supplierInvoices.vatId',
  issueDate: 'supplierInvoices.colIssued',
  dueDate: 'supplierInvoices.colDue',
  periodStart: 'supplierInvoices.periodStart',
  periodEnd: 'supplierInvoices.periodEnd',
  currency: 'supplierInvoices.currency',
  subtotalMinor: 'supplierInvoices.colNet',
  taxMinor: 'supplierInvoices.colVat',
  totalMinor: 'supplierInvoices.colTotal',
  vatLines: 'supplierInvoices.vatByRate',
  lines: 'supplierInvoices.lines',
  paymentStatus: 'supplierInvoices.colPayment',
  paidAt: 'supplierInvoices.paidAt',
  note: 'supplierInvoices.note',
}
function fieldLabel(k: string): string {
  return FIELD_KEYS[k] ? t(FIELD_KEYS[k]) : k
}
function valueText(k: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '-'
  if (/Minor$/.test(k) && typeof v === 'number') return inv.value ? fmt.dAmount(v, inv.value) : String(v)
  if (k === 'paymentStatus') return v === 'paid' ? t('supplierInvoices.statusPaid') : t('supplierInvoices.statusUnpaid')
  if (Array.isArray(v)) return t('supplierInvoices.nItems', { n: v.length })
  if (/^\d{4}-\d{2}-\d{2}/.test(String(v))) return fmt.date(String(v))
  return String(v)
}
function eventTitle(e: InvoiceEvent): string {
  switch (e.kind) {
    case 'created':
      return e.message === 'ai_prefilled' ? t('supplierInvoices.ev.createdAi') : t('supplierInvoices.ev.created')
    case 'imported':
      return e.message?.startsWith('linked')
        ? t('supplierInvoices.ev.linked')
        : t('supplierInvoices.ev.imported', { source: fmt.sourceLabel((e.message ?? 'api') as never) })
    case 'updated':
      return t('supplierInvoices.ev.updated')
    case 'payment':
      return e.message === 'paid' ? t('supplierInvoices.ev.paid') : t('supplierInvoices.ev.unpaid')
    case 'review':
      return e.message === 'verified' ? t('supplierInvoices.ev.verified') : t('supplierInvoices.ev.needsReview')
    case 'note':
      return t('supplierInvoices.ev.note')
    case 'attachment_added':
      return t('supplierInvoices.ev.attachmentAdded', { name: e.message ?? '' })
    case 'attachment_removed':
      return t('supplierInvoices.ev.attachmentRemoved', { name: e.message ?? '' })
    case 'duplicate_flag':
      return t('supplierInvoices.ev.duplicate')
    case 'reminder_due':
      return t('supplierInvoices.ev.reminderDue')
    case 'reminder_overdue':
      return t('supplierInvoices.ev.reminderOverdue')
    case 'flag':
      return t(`supplierInvoices.flag.${e.message ?? ''}`)
    default:
      return e.kind
  }
}
function eventIcon(kind: string): string {
  return (
    {
      created: 'mdi-upload-outline',
      imported: 'mdi-api',
      updated: 'mdi-pencil-outline',
      payment: 'mdi-cash-check',
      review: 'mdi-shield-check-outline',
      note: 'mdi-message-text-outline',
      attachment_added: 'mdi-paperclip',
      attachment_removed: 'mdi-paperclip-off',
      duplicate_flag: 'mdi-content-duplicate',
      reminder_due: 'mdi-bell-outline',
      reminder_overdue: 'mdi-bell-alert-outline',
      flag: 'mdi-alert-decagram-outline',
    } as Record<string, string>
  )[kind] ?? 'mdi-circle-small'
}
function changeRows(e: InvoiceEvent): { field: string; from: string; to: string }[] {
  if (e.kind !== 'updated' || !e.changes) return []
  return Object.entries(e.changes as Record<string, { from: unknown; to: unknown }>).map(([k, v]) => ({
    field: fieldLabel(k),
    from: valueText(k, v?.from),
    to: valueText(k, v?.to),
  }))
}
const issuesText = computed(() => (inv.value?.issues ?? []).map((i) => t(`supplierInvoices.issue.${i}`)))
const flagsText = computed(() => (inv.value?.flags ?? []).map((f) => t(`supplierInvoices.flag.${f}`)))
const showLines = ref(true)
const showCollection = ref(false)

/** Everything that needs a person, in one list (duplicates, consistency
 *  checks, supplier flags, a missing original). */
const attention = computed(() => {
  const i = inv.value
  if (!i) return []
  const out: { key: string; text: string; tone: 'error' | 'warning'; openId?: string }[] = []
  if (i.possibleDuplicateOf) {
    const d = i.possibleDuplicateOf
    out.push({
      key: 'dup',
      tone: 'error',
      openId: d.id,
      text: t('supplierInvoices.duplicateOf', {
        number: d.invoiceNumber ?? '-',
        date: fmt.date(d.issueDate),
        amount: d.currency === i.currency ? fmt.dAmount(d.totalMinor, i) : fmt.amount(d.totalMinor, d.currency),
      }),
    })
  }
  issuesText.value.forEach((x, n) => out.push({ key: `i${n}`, tone: 'warning', text: x }))
  ;(i.flags ?? []).forEach((f, n) => {
    if (f !== 'due_from_terms') out.push({ key: `f${n}`, tone: 'warning', text: flagsText.value[n] })
  })
  if (!i.document && i.documentError) {
    out.push({ key: 'doc', tone: 'warning', text: `${t('supplierInvoices.documentMissing')}: ${fmt.reason(i.documentError)}` })
  }
  return out
})
const isPdf = computed(() => inv.value?.document?.mime === 'application/pdf')
const isImage = computed(() => !!inv.value?.document?.mime.startsWith('image/'))
</script>

<template>
  <v-dialog
    v-model="open"
    :fullscreen="smAndDown"
    transition="slide-x-reverse-transition"
    content-class="sidr-overlay"
  >
    <v-card class="sidr" rounded="0">
    <div v-if="loading && !inv" class="sidr__pad">
      <v-skeleton-loader type="heading, list-item-two-line, list-item-two-line, table-tbody" />
    </div>
    <div v-else-if="loadError" class="sidr__pad">
      <p class="sidr__error">{{ loadError }}</p>
      <v-btn variant="text" @click="emit('close')">{{ t('common.close') }}</v-btn>
    </div>

    <template v-else-if="inv">
      <!-- Header: who / what / how much, one status, predictable actions -->
      <header class="sidr__head">
        <div class="sidr__headtop">
          <div class="sidr__id">
            <span class="sidr__supplier">{{ inv.providerName }}</span>
            <h2 class="sidr__number">{{ inv.invoiceNumber ?? '-' }}</h2>
          </div>
          <v-btn icon="mdi-close" variant="text" size="small" :aria-label="t('common.close')" @click="emit('close')" />
        </div>
        <div class="sidr__amount">
          <b>{{ fmt.dAmount(inv.totalMinor, inv) }}</b>
          <InvoiceBadge v-if="pay" v-bind="pay" size="md" />
          <span v-if="inv.processingStatus === 'needs_review' && proc" class="sidr__proc" :class="`sidr__proc--${proc.tone}`">
            <v-icon :icon="proc.icon" size="14" /> {{ proc.label }}
          </span>
        </div>
        <div class="sidr__actions">
          <v-btn
            v-if="inv.processingStatus === 'needs_review'"
            size="small"
            color="primary"
            variant="flat"
            prepend-icon="mdi-shield-check-outline"
            :loading="busy === 'verify'"
            @click="markVerified"
          >
            {{ t('supplierInvoices.markVerified') }}
          </v-btn>
          <v-btn
            v-else-if="inv.paymentStatus !== 'paid'"
            size="small"
            color="primary"
            variant="flat"
            prepend-icon="mdi-cash-check"
            :loading="busy === 'paid'"
            @click="markPaid"
          >
            {{ t('supplierInvoices.markPaid') }}
          </v-btn>
          <v-btn size="small" variant="tonal" prepend-icon="mdi-pencil-outline" :disabled="editing" @click="startEdit">
            {{ t('supplierInvoices.edit') }}
          </v-btn>
          <v-menu location="bottom end">
            <template #activator="{ props: menu }">
              <v-btn v-bind="menu" size="small" variant="text" icon="mdi-dots-horizontal" :aria-label="t('supplierInvoices.moreActions')" />
            </template>
            <v-list density="compact" min-width="230">
              <v-list-item v-if="inv.document" prepend-icon="mdi-download-outline" :title="t('supplierInvoices.download')" :href="store.documentUrl(inv.id)" />
              <v-list-item
                v-if="inv.processingStatus === 'needs_review' && inv.paymentStatus !== 'paid'"
                prepend-icon="mdi-cash-check"
                :title="t('supplierInvoices.markPaid')"
                @click="markPaid"
              />
              <v-list-item v-if="inv.paymentStatus !== 'unpaid'" prepend-icon="mdi-cash-remove" :title="t('supplierInvoices.markUnpaid')" @click="markUnpaid" />
              <template v-if="inv.source === 'manual'">
                <v-divider class="my-1" />
                <v-list-item prepend-icon="mdi-trash-can-outline" base-color="error" :title="t('supplierInvoices.delete')" @click="remove" />
              </template>
            </v-list>
          </v-menu>
        </div>
      </header>

      <!-- Attention: one list instead of one box per problem -->
      <div v-if="attention.length" class="att" role="status">
        <div class="att__title">
          <v-icon icon="mdi-alert-circle-outline" size="16" />
          {{ t('supplierInvoices.attentionTitle', { n: attention.length }) }}
        </div>
        <ul>
          <li v-for="a in attention" :key="a.key" :class="`att--${a.tone}`">
            {{ a.text }}
            <a v-if="a.openId" href="#" class="sidr__link" @click.prevent="emit('open', a.openId)">{{ t('supplierInvoices.openIt') }}</a>
          </li>
        </ul>
      </div>

      <v-tabs v-model="tab" density="compact" color="primary" class="sidr__tabs" show-arrows>
        <v-tab value="details">{{ t('supplierInvoices.tabDetails') }}</v-tab>
        <v-tab value="document">{{ t('supplierInvoices.tabDocument') }}</v-tab>
        <v-tab value="history">
          {{ t('supplierInvoices.tabHistory') }}
          <span class="sidr__count">{{ inv.events.length }}</span>
        </v-tab>
        <v-tab value="files">
          {{ t('supplierInvoices.tabFiles') }}
          <span class="sidr__count">{{ inv.attachments.length + (inv.document ? 1 : 0) }}</span>
        </v-tab>
      </v-tabs>

      <div class="sidr__body">
        <!-- DETAILS (read) -->
        <template v-if="tab === 'details' && !editing">
          <section class="blk">
            <h3 class="blk__title">{{ t('supplierInvoices.secInvoice') }}</h3>
            <dl class="dl">
              <div><dt>{{ t('supplierInvoices.colProvider') }}</dt><dd>{{ inv.providerName }}</dd></div>
              <div><dt>{{ t('supplierInvoices.vatId') }}</dt><dd>{{ inv.supplierVatId ?? '-' }}</dd></div>
              <div><dt>{{ t('supplierInvoices.colNumber') }}</dt><dd class="mono">{{ inv.invoiceNumber ?? '-' }}</dd></div>
              <div v-if="inv.docType"><dt>{{ t('supplierInvoices.docType') }}</dt><dd>{{ inv.docType }}</dd></div>
              <div><dt>{{ t('supplierInvoices.colIssued') }}</dt><dd>{{ fmt.date(inv.issueDate) }}</dd></div>
              <div>
                <dt>{{ t('supplierInvoices.colDue') }}</dt>
                <dd :class="inv.dueState ? `due--${inv.dueState}` : ''">{{ fmt.date(inv.dueDate) }}</dd>
              </div>
              <div>
                <dt>{{ t('supplierInvoices.colPeriod') }}</dt>
                <dd>{{ inv.periodStart || inv.periodEnd ? `${fmt.date(inv.periodStart)} - ${fmt.date(inv.periodEnd)}` : '-' }}</dd>
              </div>
              <div>
                <dt>{{ t('supplierInvoices.colPayment') }}</dt>
                <dd>{{ pay?.label }}<template v-if="inv.paidAt"> · {{ fmt.date(inv.paidAt) }}</template></dd>
              </div>
            </dl>
            <p v-if="inv.note" class="blk__note">{{ inv.note }}</p>
          </section>

          <section class="blk">
            <h3 class="blk__title">{{ t('supplierInvoices.secAmounts') }}</h3>
            <div class="sums">
              <div class="sums__row"><span>{{ t('supplierInvoices.colNet') }}</span><b>{{ fmt.dAmount(inv.subtotalMinor, inv) }}</b></div>
              <div v-for="(v, i) in inv.vatLines" :key="i" class="sums__row sums__row--sub">
                <span>{{ t('supplierInvoices.vatAtRate', { rate: v.rate === null ? '?' : v.rate, base: fmt.dAmount(v.netMinor, inv) }) }}</span>
                <b>{{ fmt.dAmount(v.vatMinor, inv) }}</b>
              </div>
              <div class="sums__row"><span>{{ t('supplierInvoices.colVat') }}</span><b>{{ fmt.dAmount(inv.taxMinor, inv) }}</b></div>
              <div class="sums__row sums__row--total"><span>{{ t('supplierInvoices.colTotal') }}</span><b>{{ fmt.dAmount(inv.totalMinor, inv) }}</b></div>
              <div v-if="fmt.conversion(inv) && fmt.conversion(inv)!.rate !== 1" class="sums__fx">
                {{
                  t('supplierInvoices.convertedNote', {
                    rate: fmt.conversion(inv)!.rate.toLocaleString('ro-RO', { maximumFractionDigits: 4 }),
                    date: fmt.date(fmt.conversion(inv)!.rateDate),
                  })
                }}
              </div>
            </div>
          </section>

          <section v-if="inv.lines.length" class="blk">
            <button type="button" class="blk__toggle" :aria-expanded="showLines" @click="showLines = !showLines">
              <span class="blk__title">{{ t('supplierInvoices.lines') }} ({{ inv.lines.length }})</span>
              <v-icon :icon="showLines ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="16" />
            </button>
            <div v-if="showLines" class="lines">
              <div class="lines__head">
                <span>{{ t('supplierInvoices.lineDesc') }}</span>
                <span class="num">{{ t('supplierInvoices.lineQty') }}</span>
                <span class="num">{{ t('supplierInvoices.lineUnit') }}</span>
                <span class="num">{{ t('supplierInvoices.colNet') }}</span>
                <span class="num">{{ t('supplierInvoices.lineVat') }}</span>
              </div>
              <div v-for="(l, i) in inv.lines" :key="i" class="lines__row">
                <span class="lines__desc" :title="l.description">{{ l.description }}</span>
                <span class="num">{{ l.quantity ?? '-' }}</span>
                <span class="num">{{ fmt.dAmount(l.unitPriceMinor, inv) }}</span>
                <span class="num">{{ fmt.dAmount(l.netMinor, inv) }}</span>
                <span class="num">{{ l.vatRate === null ? '-' : `${l.vatRate}%` }}</span>
              </div>
            </div>
          </section>

          <section class="blk">
            <button type="button" class="blk__toggle" :aria-expanded="showCollection" @click="showCollection = !showCollection">
              <span class="blk__title">{{ t('supplierInvoices.secCollection') }}</span>
              <span class="blk__hint">{{ fmt.sourceLabel(inv.source) }} · {{ fmt.dateTime(inv.createdAt) }}</span>
              <v-icon :icon="showCollection ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="16" />
            </button>
            <dl v-if="showCollection" class="dl">
              <div><dt>{{ t('supplierInvoices.collectionMethod') }}</dt><dd>{{ fmt.sourceLabel(inv.source) }}</dd></div>
              <div><dt>{{ t('supplierInvoices.importedAt') }}</dt><dd>{{ fmt.dateTime(inv.createdAt) }}</dd></div>
              <div v-if="inv.createdByName"><dt>{{ t('supplierInvoices.addedBy') }}</dt><dd>{{ inv.createdByName }}</dd></div>
              <div v-if="inv.externalId"><dt>{{ t('supplierInvoices.providerId') }}</dt><dd class="mono">{{ inv.externalId }}</dd></div>
              <div v-if="inv.correctedFields.length">
                <dt>{{ t('supplierInvoices.correctedFields') }}</dt>
                <dd>{{ inv.correctedFields.map(fieldLabel).join(', ') }}</dd>
              </div>
              <div v-if="inv.extraction" class="dl__wide">
                <dt>{{ t('supplierInvoices.extraction') }}</dt>
                <dd>
                  <template v-if="inv.extraction.engine === 'xml'">{{ t('supplierInvoices.extractedXml', { format: inv.extraction.model }) }}</template>
                  <template v-else>
                    {{ t('supplierInvoices.extractedBy', { model: inv.extraction.model, pct: Math.round((inv.extraction.confidence ?? 0) * 100) }) }}
                    {{ t('supplierInvoices.aiDisclaimer') }}
                  </template>
                </dd>
              </div>
            </dl>
          </section>
        </template>

        <!-- DETAILS (edit) -->
        <form v-else-if="tab === 'details' && editing" class="edit" @submit.prevent="saveEdit">
          <p class="edit__hint">{{ t('supplierInvoices.editHint') }}</p>
          <div class="edit__grid">
            <v-text-field
              v-if="inv.provider === 'other'"
              v-model="ed.providerName"
              :label="t('supplierInvoices.providerName')"
              density="comfortable"
              maxlength="120"
            />
            <v-text-field v-model="ed.invoiceNumber" :label="t('supplierInvoices.colNumber')" density="comfortable" maxlength="80" />
            <v-text-field v-model="ed.supplierVatId" :label="t('supplierInvoices.vatId')" density="comfortable" maxlength="40" />
            <v-text-field v-model="ed.issueDate" type="date" :label="t('supplierInvoices.colIssued')" density="comfortable" />
            <v-text-field v-model="ed.dueDate" type="date" :label="t('supplierInvoices.colDue')" density="comfortable" />
            <v-text-field v-model="ed.periodStart" type="date" :label="t('supplierInvoices.periodStart')" density="comfortable" />
            <v-text-field v-model="ed.periodEnd" type="date" :label="t('supplierInvoices.periodEnd')" density="comfortable" />
          </div>
          <div class="edit__money">
            <v-text-field v-model.number="ed.subtotal" type="number" step="0.01" min="0" :label="t('supplierInvoices.colNet')" density="comfortable" />
            <v-text-field v-model.number="ed.tax" type="number" step="0.01" min="0" :label="t('supplierInvoices.colVat')" density="comfortable" />
            <v-text-field v-model.number="ed.total" type="number" step="0.01" min="0" :label="t('supplierInvoices.colTotal')" density="comfortable" />
            <v-select v-model="ed.currency" :items="CURRENCIES" :label="t('supplierInvoices.currency')" density="comfortable" />
          </div>

          <div class="edit__vat">
            <div class="edit__vathead">
              <span>{{ t('supplierInvoices.vatByRate') }}</span>
              <v-btn size="x-small" variant="text" prepend-icon="mdi-plus" @click="ed.vatLines.push({ rate: null, net: null, vat: null })">
                {{ t('supplierInvoices.addRate') }}
              </v-btn>
            </div>
            <div v-for="(v, i) in ed.vatLines" :key="i" class="edit__vatrow">
              <v-text-field v-model.number="v.rate" type="number" step="0.01" min="0" :label="t('supplierInvoices.rate')" density="compact" suffix="%" />
              <v-text-field v-model.number="v.net" type="number" step="0.01" min="0" :label="t('supplierInvoices.base')" density="compact" />
              <v-text-field v-model.number="v.vat" type="number" step="0.01" min="0" :label="t('supplierInvoices.colVat')" density="compact" />
              <v-btn icon="mdi-close" size="small" variant="text" :aria-label="t('supplierInvoices.delete')" @click="ed.vatLines.splice(i, 1)" />
            </div>
          </div>

          <div class="edit__grid">
            <v-select
              v-model="ed.paymentStatus"
              :items="[
                { value: 'paid', title: t('supplierInvoices.statusPaid') },
                { value: 'unpaid', title: t('supplierInvoices.statusUnpaid') },
              ]"
              :label="t('supplierInvoices.colPayment')"
              clearable
              density="comfortable"
            />
            <v-text-field
              v-if="ed.paymentStatus === 'paid'"
              v-model="ed.paidAt"
              type="date"
              :label="t('supplierInvoices.paidAt')"
              density="comfortable"
            />
          </div>
          <v-text-field v-model="ed.note" :label="t('supplierInvoices.note')" density="comfortable" maxlength="300" />
          <div class="edit__actions">
            <span class="edit__changed">{{ t('supplierInvoices.changedFields', { n: Object.keys(patch).length }) }}</span>
            <v-btn variant="text" @click="editing = false">{{ t('common.cancel') }}</v-btn>
            <v-btn type="submit" color="primary" variant="flat" :loading="busy === 'save'" :disabled="!canSave">
              {{ t('common.save') }}
            </v-btn>
          </div>
        </form>

        <!-- DOCUMENT -->
        <template v-else-if="tab === 'document'">
          <div v-if="!inv.document" class="empty">
            <v-icon icon="mdi-file-document-remove-outline" size="28" />
            <p>{{ inv.documentError ? fmt.reason(inv.documentError) : t('supplierInvoices.noDocument') }}</p>
          </div>
          <template v-else>
            <div class="docbar">
              <span class="docbar__name">{{ inv.document.filename }} · {{ fmt.fileSize(inv.document.size) }}</span>
              <v-btn size="small" variant="text" prepend-icon="mdi-open-in-new" :href="store.documentUrl(inv.id, true)" target="_blank" rel="noopener">
                {{ t('supplierInvoices.open') }}
              </v-btn>
              <v-btn size="small" variant="text" prepend-icon="mdi-download-outline" :href="store.documentUrl(inv.id)">
                {{ t('supplierInvoices.download') }}
              </v-btn>
            </div>
            <iframe v-if="isPdf" :src="store.documentUrl(inv.id, true)" class="docview" :title="inv.document.filename" />
            <img v-else-if="isImage" :src="store.documentUrl(inv.id, true)" class="docimg" :alt="inv.document.filename" />
            <pre v-else class="docxml">{{ xmlText ?? t('common.loading') }}</pre>
          </template>
        </template>

        <!-- HISTORY + NOTES -->
        <template v-else-if="tab === 'history'">
          <form class="notebox" @submit.prevent="addNote">
            <v-textarea
              v-model="noteText"
              :label="t('supplierInvoices.addNote')"
              rows="2"
              auto-grow
              density="comfortable"
              maxlength="2000"
              hide-details
            />
            <v-btn type="submit" size="small" color="primary" variant="tonal" :loading="busy === 'note'" :disabled="!noteText.trim()">
              {{ t('supplierInvoices.saveNote') }}
            </v-btn>
          </form>
          <ol class="tl">
            <li v-for="e in inv.events" :key="e.id" class="tl__item" :class="{ 'tl__item--note': e.kind === 'note' }">
              <v-icon :icon="eventIcon(e.kind)" size="16" class="tl__icon" aria-hidden="true" />
              <div class="tl__body">
                <div class="tl__title">
                  <strong>{{ eventTitle(e) }}</strong>
                  <span>{{ e.actorName ?? t('supplierInvoices.system') }} · {{ fmt.dateTime(e.createdAt) }}</span>
                </div>
                <p v-if="e.kind === 'note'" class="tl__note">{{ e.message }}</p>
                <ul v-if="changeRows(e).length" class="tl__changes">
                  <li v-for="c in changeRows(e)" :key="c.field">
                    <span>{{ c.field }}:</span> <s>{{ c.from }}</s> → <b>{{ c.to }}</b>
                  </li>
                </ul>
              </div>
            </li>
          </ol>
        </template>

        <!-- FILES -->
        <template v-else-if="tab === 'files'">
          <ul class="files">
            <li v-if="inv.document" class="files__row">
              <v-icon icon="mdi-file-document-outline" size="18" />
              <span class="files__name">{{ inv.document.filename }}</span>
              <span class="files__tag">{{ t('supplierInvoices.original') }}</span>
              <v-btn icon="mdi-download-outline" size="small" variant="text" :href="store.documentUrl(inv.id)" :aria-label="t('supplierInvoices.download')" />
            </li>
            <li v-for="a in inv.attachments" :key="a.id" class="files__row">
              <v-icon icon="mdi-paperclip" size="18" />
              <span class="files__name">
                {{ a.filename }}
                <small>{{ fmt.fileSize(a.size) }} · {{ a.uploadedByName ?? '' }} · {{ fmt.dateTime(a.createdAt) }}</small>
              </span>
              <v-btn icon="mdi-open-in-new" size="small" variant="text" :href="store.attachmentUrl(inv.id, a.id, true)" target="_blank" rel="noopener" :aria-label="t('supplierInvoices.open')" />
              <v-btn icon="mdi-download-outline" size="small" variant="text" :href="store.attachmentUrl(inv.id, a.id)" :aria-label="t('supplierInvoices.download')" />
              <v-btn icon="mdi-trash-can-outline" size="small" variant="text" color="error" :aria-label="t('supplierInvoices.delete')" @click="removeAttachment(a.id, a.filename)" />
            </li>
          </ul>
          <input ref="fileInput" type="file" :accept="FILE_ACCEPT" hidden @change="onAttach" />
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-paperclip"
            :loading="busy === 'attach'"
            class="files__add"
            @click="fileInput?.click()"
          >
            {{ t('supplierInvoices.addFile') }}
          </v-btn>
          <p class="files__hint">{{ t('supplierInvoices.filesHint') }}</p>
        </template>
      </div>
    </template>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.sidr {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
}
.sidr__pad {
  padding: 1.25rem;
}
.sidr__error {
  color: rgb(var(--v-theme-error));
  font-size: var(--tvz-fs-body);
}
.sidr__head {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 1.1rem 1.25rem 0.9rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.sidr__headtop {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}
.sidr__id {
  min-width: 0;
}
.sidr__supplier {
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.62);
}
.sidr__number {
  margin: 0.1rem 0 0;
  font-size: var(--tvz-fs-dialog-title);
  font-weight: 700;
  overflow-wrap: anywhere;
}
.sidr__amount {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.75rem;
}
.sidr__amount b {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.6rem;
  font-variant-numeric: tabular-nums;
}
.sidr__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.sidr__proc {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-size: var(--tvz-fs-small);
  font-weight: 600;
}
.sidr__proc--warning {
  color: rgb(var(--v-theme-warning));
}
.sidr__proc--error {
  color: rgb(var(--v-theme-error));
}
.att {
  margin: 0.9rem 1.25rem 0;
  padding: 0.6rem 0.8rem;
  border: 1px solid rgba(var(--v-theme-warning), 0.35);
  border-radius: 10px;
  background: rgba(var(--v-theme-warning), 0.05);
  font-size: var(--tvz-fs-small);
}
.att__title {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-weight: 600;
  color: rgb(var(--v-theme-warning));
}
.att ul {
  margin: 0.3rem 0 0;
  padding-left: 1.4rem;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.att li {
  padding: 0.1rem 0;
}
.att--error::marker {
  color: rgb(var(--v-theme-error));
}
.blk__toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  margin-bottom: 0.5rem;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.blk__toggle .blk__title {
  margin: 0;
}
.blk__hint {
  margin-left: auto;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.dl__wide {
  grid-column: 1 / -1;
}
.lines__desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidr__alerts {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.9rem 1.25rem 0;
  font-size: var(--tvz-fs-small);
}
.sidr__issues {
  margin: 0.2rem 0 0;
  padding-left: 1.1rem;
}
.sidr__link {
  margin-left: 0.35rem;
  color: inherit;
  font-weight: 700;
}
.sidr__tabs {
  padding: 0 0.75rem;
  margin-top: 0.4rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.sidr__count {
  margin-left: 0.35rem;
  padding: 0 0.35rem;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
}
.sidr__body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  padding: 1.1rem 1.25rem 1.5rem;
}

.blk__title {
  margin: 0 0 0.5rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.blk__note {
  margin: 0.6rem 0 0;
  padding: 0.55rem 0.7rem;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: var(--tvz-fs-small);
}
.dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem 1.25rem;
  margin: 0;
}
.dl dt {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.dl dd {
  margin: 0.1rem 0 0;
  font-size: var(--tvz-fs-body);
  overflow-wrap: anywhere;
}
.mono {
  font-variant-numeric: tabular-nums;
}
.due--overdue {
  color: rgb(var(--v-theme-error));
  font-weight: 700;
}
.due--due_soon {
  color: rgb(var(--v-theme-warning));
  font-weight: 700;
}
.sums {
  border: 1px solid var(--tvz-glass-border);
  border-radius: 10px;
  overflow: hidden;
}
.sums__row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem 0.8rem;
  font-size: var(--tvz-fs-body);
  border-bottom: 1px solid var(--tvz-hairline);
}
.sums__row b {
  font-variant-numeric: tabular-nums;
}
.sums__row--sub {
  padding-left: 1.4rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.sums__fx {
  padding: 0.45rem 0.8rem;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
  border-top: 1px solid var(--tvz-hairline);
}
.sums__row--total {
  border-bottom: 0;
  background: rgba(var(--v-theme-on-surface), 0.035);
  font-weight: 700;
}
.lines {
  border: 1px solid var(--tvz-glass-border);
  border-radius: 10px;
  overflow-x: auto;
  font-size: var(--tvz-fs-small);
}
.lines__head,
.lines__row {
  display: grid;
  grid-template-columns: minmax(10rem, 1fr) 3.5rem 6.5rem 6.5rem 3.5rem;
  gap: 0.6rem;
  padding: 0.45rem 0.7rem;
  min-width: 34rem;
}
.lines__head {
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.5);
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.lines__row {
  border-top: 1px solid var(--tvz-hairline);
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.edit {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.edit__hint {
  margin: 0 0 0.6rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.edit__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 0.6rem;
}
.edit__money {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) 6.5rem;
  gap: 0 0.6rem;
}
.edit__vat {
  margin: 0 0 0.9rem;
  padding: 0.6rem 0.7rem 0.2rem;
  border: 1px dashed var(--tvz-hairline);
  border-radius: 10px;
}
.edit__vathead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.4rem;
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.62);
}
.edit__vatrow {
  display: grid;
  grid-template-columns: 6rem minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 0.5rem;
  align-items: start;
}
.edit__actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  justify-content: flex-end;
  position: sticky;
  bottom: 0;
  padding: 0.6rem 0;
  background: rgb(var(--v-theme-surface));
}
.edit__changed {
  margin-right: auto;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  padding: 2rem 1rem;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: var(--tvz-fs-small);
}
.docbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
}
.docbar__name {
  margin-right: auto;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.65);
  overflow-wrap: anywhere;
}
.docview {
  width: 100%;
  min-height: 70vh;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 10px;
  background: #fff;
}
.docimg {
  max-width: 100%;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 10px;
}
.docxml {
  max-height: 70vh;
  overflow: auto;
  margin: 0;
  padding: 0.8rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 10px;
  font-size: var(--tvz-fs-caption);
  white-space: pre-wrap;
  word-break: break-all;
}

.notebox {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.4rem;
}
.notebox > :first-child {
  width: 100%;
}
.tl {
  list-style: none;
  margin: 0;
  padding: 0;
}
.tl__item {
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr);
  gap: 0.5rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--tvz-hairline);
}
.tl__item:last-child {
  border-bottom: 0;
}
.tl__icon {
  margin-top: 0.1rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.tl__title {
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem 0.6rem;
  align-items: baseline;
  font-size: var(--tvz-fs-small);
}
.tl__title span {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.tl__note {
  margin: 0.3rem 0 0;
  padding: 0.5rem 0.65rem;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.07);
  font-size: var(--tvz-fs-small);
  white-space: pre-wrap;
}
.tl__changes {
  margin: 0.3rem 0 0;
  padding-left: 1rem;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.tl__changes s {
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.files {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 10px;
}
.files__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.6rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.files__row:last-child {
  border-bottom: 0;
}
.files__name {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--tvz-fs-small);
  overflow-wrap: anywhere;
}
.files__name small {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.files__tag {
  padding: 0.05rem 0.4rem;
  border-radius: 4px;
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
}
.files__add {
  align-self: flex-start;
}
.files__hint {
  margin: 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}

@media (max-width: 560px) {
  .dl,
  .edit__grid {
    grid-template-columns: 1fr;
  }
  .edit__money {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .edit__vatrow {
    grid-template-columns: 4.5rem minmax(0, 1fr) minmax(0, 1fr) auto;
  }
}
</style>

<style>
/* The dialog is teleported to the overlay container: a right-hand panel,
   full height, the whole screen on phones (where Vuetify's fullscreen
   already applies). */
.sidr-overlay:not(.v-dialog--fullscreen) {
  position: fixed !important;
  inset: 0 0 0 auto !important;
  margin: 0 !important;
  width: min(680px, 100vw) !important;
  max-width: 100vw !important;
  height: 100% !important;
  max-height: 100% !important;
}
.sidr-overlay > .v-card {
  height: 100%;
}
</style>
