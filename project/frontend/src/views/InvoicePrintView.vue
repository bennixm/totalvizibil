<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import { apiFetch, ApiError } from '@/services/api'
import type { Invoice } from '@/stores/billing'

const { t, n } = useI18n()
const route = useRoute()

const invoice = ref<Invoice | null>(null)
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    invoice.value = await apiFetch<Invoice>(`/account/billing/invoices/${route.params.id}`)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('invoice.loadError')
  } finally {
    loading.value = false
  }
})

function ron(minor: number): string {
  return `${n(minor / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON`
}
const issuedDate = computed(() =>
  invoice.value ? new Date(invoice.value.issuedAt).toLocaleDateString() : '',
)
const buyerKindLabel = computed(() =>
  invoice.value?.buyerKind === 'company' ? t('invoice.kindCompany') : t('invoice.kindIndividual'),
)

function addressLine(row: {
  address: string
  city: string
  county?: string | null
  postalCode?: string | null
  country: string
}): string {
  return [row.address, [row.county, row.city].filter(Boolean).join(', '), row.postalCode, row.country]
    .filter(Boolean)
    .join(', ')
}
const buyerAddress = computed(() =>
  invoice.value
    ? addressLine({
        address: invoice.value.buyerAddress,
        city: invoice.value.buyerCity,
        county: invoice.value.buyerCounty,
        postalCode: invoice.value.buyerPostalCode,
        country: invoice.value.buyerCountry,
      })
    : '',
)
function doPrint(): void {
  window.print()
}
</script>

<template>
  <div class="ip">
    <div class="ip__toolbar no-print">
      <v-btn variant="text" prepend-icon="mdi-arrow-left" :to="{ name: 'account', query: { tab: 'billing' } }">
        {{ t('invoice.back') }}
      </v-btn>
      <v-btn v-if="invoice" color="primary" prepend-icon="mdi-printer-outline" @click="doPrint">
        {{ t('invoice.print') }}
      </v-btn>
    </div>

    <div v-if="loading" class="ip__center no-print"><v-progress-circular indeterminate color="primary" /></div>
    <div v-else-if="error" class="ip__center no-print">
      <v-icon icon="mdi-alert-circle-outline" size="28" />
      <p>{{ error }}</p>
    </div>

    <article v-else-if="invoice" class="invoice-print">
      <header class="doc__head">
        <div>
          <h1>{{ invoice.issuerName }}</h1>
          <p class="doc__sub">{{ t('invoice.docTitle') }}</p>
        </div>
        <div class="doc__meta">
          <p><strong>{{ invoice.number }}</strong></p>
          <p>{{ t('invoice.issuedOn') }} {{ issuedDate }}</p>
        </div>
      </header>

      <section class="doc__parties">
        <div>
          <span class="doc__k">{{ t('invoice.issuer') }}</span>
          <p class="doc__name">{{ invoice.issuerName }}</p>
          <p v-if="invoice.issuerTaxId">{{ t('invoice.taxId') }}: {{ invoice.issuerTaxId }}</p>
          <p v-if="invoice.issuerRegCom">{{ t('invoice.regCom') }}: {{ invoice.issuerRegCom }}</p>
          <p>{{ invoice.issuerAddress }}</p>
          <p v-if="invoice.issuerIban">
            IBAN: {{ invoice.issuerIban }}<template v-if="invoice.issuerBank"> · {{ invoice.issuerBank }}</template>
          </p>
        </div>
        <div>
          <span class="doc__k">{{ t('invoice.buyer') }}</span>
          <p class="doc__name">{{ invoice.buyerName }}</p>
          <p class="doc__muted">{{ buyerKindLabel }}</p>
          <p v-if="invoice.buyerTaxId">{{ t('invoice.taxId') }}: {{ invoice.buyerTaxId }}</p>
          <p v-if="invoice.buyerRegCom">{{ t('invoice.regCom') }}: {{ invoice.buyerRegCom }}</p>
          <p>{{ buyerAddress }}</p>
          <p v-if="invoice.buyerEmail">{{ invoice.buyerEmail }}</p>
        </div>
      </section>

      <table class="doc__lines">
        <thead>
          <tr>
            <th>{{ t('invoice.colDescription') }}</th>
            <th class="num">{{ t('invoice.colQty') }}</th>
            <th class="num">{{ t('invoice.colUnitPrice') }}</th>
            <th class="num">{{ t('invoice.colVat') }}</th>
            <th class="num">{{ t('invoice.colLineTotal') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{{ invoice.description }}</td>
            <td class="num">1</td>
            <td class="num">{{ ron(invoice.subtotalMinor) }}</td>
            <td class="num">{{ invoice.vatRatePct }}%</td>
            <td class="num">{{ ron(invoice.totalMinor) }}</td>
          </tr>
        </tbody>
      </table>

      <section class="doc__totals">
        <div><span>{{ t('invoice.subtotal') }}</span><strong>{{ ron(invoice.subtotalMinor) }}</strong></div>
        <div>
          <span>{{ t('invoice.vat') }} ({{ invoice.vatRatePct }}%)</span>
          <strong>{{ invoice.vatRatePct > 0 ? ron(invoice.vatMinor) : t('invoice.vatExempt') }}</strong>
        </div>
        <div class="doc__grandTotal"><span>{{ t('invoice.total') }}</span><strong>{{ ron(invoice.totalMinor) }}</strong></div>
      </section>

      <footer class="doc__foot">
        <p v-if="invoice.eurCents != null && invoice.fxRate != null">
          {{ t('invoice.paidVia', { eur: (invoice.eurCents / 100).toFixed(2), rate: invoice.fxRate }) }}
        </p>
        <p>{{ t('invoice.generatedNote') }}</p>
      </footer>
    </article>
  </div>
</template>

<style scoped>
.ip {
  max-width: 820px;
  margin: 0 auto;
  padding: clamp(1rem, 4vw, 2.5rem);
}
.ip__toolbar {
  display: flex;
  justify-content: space-between;
  margin-bottom: 1.25rem;
}
.ip__center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  padding: 3rem 1rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}

.invoice-print {
  /* Always a printed-paper look — a fixed light surface regardless of the
     viewer's app theme (dark mode would otherwise pair this dark ink with a
     dark --v-theme-surface and make the whole document unreadable). */
  padding: clamp(1.5rem, 4vw, 3rem);
  border-radius: var(--tvz-radius-lg);
  border: 1px solid #e5e7eb;
  background: #ffffff;
  color: #17181c;
  font-size: 0.92rem;
  box-shadow: var(--tvz-shadow-md, 0 8px 30px -12px rgba(0, 0, 0, 0.35));
}
.doc__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  padding-bottom: 1.1rem;
  margin-bottom: 1.3rem;
  border-bottom: 2px solid #17181c;
}
.doc__head h1 {
  margin: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.3rem;
}
.doc__sub {
  margin: 0.15rem 0 0;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.72rem;
  color: #6b7280;
}
.doc__meta {
  text-align: right;
}
.doc__meta p {
  margin: 0;
}
.doc__parties {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  margin-bottom: 1.4rem;
}
.doc__parties p {
  margin: 0.1rem 0;
  line-height: 1.45;
}
.doc__k {
  display: block;
  margin-bottom: 0.3rem;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #6b7280;
}
.doc__name {
  font-weight: 700;
  font-size: 1rem;
}
.doc__muted {
  color: #6b7280;
}
.doc__lines {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 1.1rem;
}
.doc__lines th,
.doc__lines td {
  padding: 0.55rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid #e5e7eb;
}
.doc__lines th {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6b7280;
  border-bottom: 2px solid #17181c;
}
.doc__lines .num {
  text-align: right;
  white-space: nowrap;
}
.doc__totals {
  margin-left: auto;
  width: min(320px, 100%);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 1.6rem;
}
.doc__totals > div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}
.doc__grandTotal {
  padding-top: 0.5rem;
  border-top: 2px solid #17181c;
  font-size: 1.1rem;
}
.doc__foot {
  border-top: 1px solid #e5e7eb;
  padding-top: 0.9rem;
  color: #6b7280;
  font-size: 0.78rem;
}
.doc__foot p {
  margin: 0.15rem 0;
}
</style>

<style>
/* Global (unscoped) so it can reach the app chrome around this view. */
@media print {
  body * {
    visibility: hidden;
  }
  .invoice-print,
  .invoice-print * {
    visibility: visible;
  }
  .invoice-print {
    position: absolute;
    inset: 0;
    border: 0;
    color: #17181c;
    background: #fff;
  }
  .no-print {
    display: none !important;
  }
}
</style>
