<script setup lang="ts">
/** Attention strip above the invoice list: recurring invoices that haven't
 *  arrived this month, and invoices flagged as unusual. Shown only when
 *  there is something to act on. */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { InvoiceInsights } from '@/stores/externalInvoices'

import { useInvoiceFormat } from './useInvoiceFormat'

const props = defineProps<{ insights: InvoiceInsights | null }>()
const emit = defineEmits<{ open: [id: string]; supplier: [id: string] }>()

const { t } = useI18n()
const fmt = useInvoiceFormat()
const show = computed(() => !!props.insights && (props.insights.missingRecurring.length || props.insights.anomalies.length))
</script>

<template>
  <section v-if="show && insights" class="ins" :aria-label="t('supplierInvoices.insightsTitle')">
    <div v-if="insights.missingRecurring.length" class="ins__box ins__box--warn">
      <v-icon icon="mdi-calendar-alert" size="18" class="ins__icon" />
      <div class="ins__body">
        <strong>{{ t('supplierInvoices.missingTitle', { n: insights.missingRecurring.length }) }}</strong>
        <ul>
          <li v-for="m in insights.missingRecurring" :key="m.supplier.id">
            <a href="#" @click.prevent="emit('supplier', m.supplier.id)">{{ m.supplier.name }}</a>:
            {{ t('supplierInvoices.missingLine', { day: m.usualDay, amount: fmt.amount(m.avgMinor, m.currency), date: fmt.date(m.expectedBy) }) }}
          </li>
        </ul>
      </div>
    </div>
    <div v-if="insights.anomalies.length" class="ins__box ins__box--err">
      <v-icon icon="mdi-alert-decagram-outline" size="18" class="ins__icon" />
      <div class="ins__body">
        <strong>{{ t('supplierInvoices.anomaliesTitle', { n: insights.anomalies.length }) }}</strong>
        <ul>
          <li v-for="a in insights.anomalies" :key="a.id">
            <a href="#" @click.prevent="emit('open', a.id)">{{ a.supplierName ?? '-' }} {{ a.invoiceNumber ?? '' }}</a>
            ({{ fmt.amount(a.totalMinor, a.currency) }}):
            {{ a.flags.filter((f) => f !== 'due_from_terms').map((f) => t(`supplierInvoices.flag.${f}`)).join(', ') }}
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ins {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  gap: 0.6rem;
}
.ins__box {
  display: flex;
  gap: 0.6rem;
  padding: 0.7rem 0.9rem;
  border-radius: 12px;
  border: 1px solid;
  font-size: var(--tvz-fs-small);
}
.ins__box--warn {
  border-color: rgba(var(--v-theme-warning), 0.4);
  background: rgba(var(--v-theme-warning), 0.07);
}
.ins__box--warn .ins__icon {
  color: rgb(var(--v-theme-warning));
}
.ins__box--err {
  border-color: rgba(var(--v-theme-error), 0.4);
  background: rgba(var(--v-theme-error), 0.06);
}
.ins__box--err .ins__icon {
  color: rgb(var(--v-theme-error));
}
.ins__body {
  min-width: 0;
}
.ins__body ul {
  margin: 0.25rem 0 0;
  padding-left: 1rem;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.ins__body a {
  color: rgb(var(--v-theme-on-surface));
  font-weight: 600;
}
</style>
