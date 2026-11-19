<script setup lang="ts">
/** One quiet attention line (missing recurring invoices, unusual invoices)
 *  that expands into the full list. Hidden when there is nothing to act on. */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { InvoiceInsights } from '@/stores/externalInvoices'

import { useInvoiceFormat } from './useInvoiceFormat'

const props = defineProps<{ insights: InvoiceInsights | null }>()
const emit = defineEmits<{ open: [id: string]; supplier: [id: string] }>()

const { t } = useI18n()
const fmt = useInvoiceFormat()
const open = ref(false)
const missing = computed(() => props.insights?.missingRecurring ?? [])
const anomalies = computed(() => props.insights?.anomalies ?? [])
const show = computed(() => missing.value.length + anomalies.value.length > 0)
</script>

<template>
  <section v-if="show" class="ins" :aria-label="t('supplierInvoices.insightsTitle')">
    <button type="button" class="ins__bar" :aria-expanded="open" @click="open = !open">
      <v-icon icon="mdi-alert-circle-outline" size="17" class="ins__icon" />
      <span class="ins__title">{{ t('supplierInvoices.insightsTitle') }}</span>
      <span v-if="missing.length" class="ins__part">{{ t('supplierInvoices.missingShort', { n: missing.length }) }}</span>
      <span v-if="anomalies.length" class="ins__part">{{ t('supplierInvoices.anomaliesShort', { n: anomalies.length }) }}</span>
      <v-icon :icon="open ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="17" class="ins__chev" />
    </button>
    <v-expand-transition>
      <div v-if="open" class="ins__body">
        <ul v-if="missing.length">
          <li v-for="m in missing" :key="m.supplier.id">
            <v-icon icon="mdi-calendar-alert" size="14" class="ins__li-icon ins__li-icon--warn" />
            <a href="#" @click.prevent="emit('supplier', m.supplier.id)">{{ m.supplier.name }}</a>
            <span>
              {{ t('supplierInvoices.missingLine', { day: m.usualDay, amount: fmt.amount(m.avgMinor, m.currency), date: fmt.date(m.expectedBy) }) }}
            </span>
          </li>
        </ul>
        <ul v-if="anomalies.length">
          <li v-for="a in anomalies" :key="a.id">
            <v-icon icon="mdi-alert-decagram-outline" size="14" class="ins__li-icon ins__li-icon--err" />
            <a href="#" @click.prevent="emit('open', a.id)">{{ a.supplierName ?? '-' }} {{ a.invoiceNumber ?? '' }}</a>
            <span>
              {{ fmt.amount(a.totalMinor, a.currency) }}:
              {{ a.flags.filter((f) => f !== 'due_from_terms').map((f) => t(`supplierInvoices.flag.${f}`)).join(', ') }}
            </span>
          </li>
        </ul>
      </div>
    </v-expand-transition>
  </section>
</template>

<style scoped>
.ins {
  border: 1px solid rgba(var(--v-theme-warning), 0.35);
  border-radius: 10px;
  background: rgba(var(--v-theme-warning), 0.05);
}
.ins__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.2rem 0.6rem;
  width: 100%;
  padding: 0.5rem 0.8rem;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-size: var(--tvz-fs-small);
  text-align: left;
  cursor: pointer;
}
.ins__bar:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
  border-radius: 10px;
}
.ins__icon {
  color: rgb(var(--v-theme-warning));
}
.ins__title {
  font-weight: 600;
}
.ins__part {
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.ins__part + .ins__part::before {
  content: '·';
  margin-right: 0.6rem;
  opacity: 0.5;
}
.ins__chev {
  margin-left: auto;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.ins__body {
  padding: 0 0.8rem 0.6rem 2.2rem;
  font-size: var(--tvz-fs-small);
}
.ins__body ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.ins__body li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.15rem 0.4rem;
  padding: 0.2rem 0;
  color: rgba(var(--v-theme-on-surface), 0.72);
}
.ins__li-icon {
  align-self: center;
}
.ins__li-icon--warn {
  color: rgb(var(--v-theme-warning));
}
.ins__li-icon--err {
  color: rgb(var(--v-theme-error));
}
.ins__body a {
  color: rgb(var(--v-theme-on-surface));
  font-weight: 600;
}
</style>
