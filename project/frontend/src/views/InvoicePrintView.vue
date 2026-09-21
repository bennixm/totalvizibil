<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import InvoiceDocument from '@/components/InvoiceDocument.vue'
import { apiFetch, ApiError } from '@/services/api'
import type { Invoice } from '@/stores/billing'

const { t } = useI18n()
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

    <InvoiceDocument v-else-if="invoice" class="invoice-print" :invoice="invoice" />
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
  color: rgba(var(--v-theme-on-surface), 0.6);
}

/* The document itself is the shared InvoiceDocument component — this just
   adds the floating-paper elevation that only makes sense on this full,
   standalone print page (a dialog-embedded copy doesn't need it). */
.invoice-print {
  box-shadow: var(--tvz-shadow-md, 0 8px 30px -12px rgba(0, 0, 0, 0.35));
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
