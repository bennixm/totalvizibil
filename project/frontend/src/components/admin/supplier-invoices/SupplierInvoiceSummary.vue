<script setup lang="ts">
/**
 * Compact summary. The four numbers that ask for action (unpaid, overdue,
 * due soon, needs review) sit in one strip and double as quick filters;
 * the month figures (received, value, VAT estimate, automatic vs manual)
 * are one quiet line, with the VAT-by-rate breakdown and all-time counts
 * one click away. Every value is still computed server-side from stored
 * invoices, in the platform display currency.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { InvoiceSummary } from '@/stores/externalInvoices'

import { useInvoiceFormat } from './useInvoiceFormat'

type Key = 'month' | 'unpaid' | 'due_soon' | 'overdue' | 'needs_review'
const props = defineProps<{ summary: InvoiceSummary | null; error: string | null; active: string | null }>()
const emit = defineEmits<{ pick: [key: Key] }>()

const { t } = useI18n()
const fmt = useInvoiceFormat()
const showMore = ref(false)

const total = (rows: { currency: string; totalMinor: number }[]) =>
  rows.length ? rows.map((r) => fmt.amount(r.totalMinor, r.currency)).join(' · ') : ''

const primary = computed(() => {
  const s = props.summary
  if (!s) return []
  return [
    { key: 'unpaid' as const, label: t('supplierInvoices.kpiUnpaid'), n: s.unpaid.count, amount: total(s.unpaid.totals), tone: 'info' },
    { key: 'overdue' as const, label: t('supplierInvoices.kpiOverdue'), n: s.overdue.count, amount: total(s.overdue.totals), tone: 'error' },
    {
      key: 'due_soon' as const,
      label: t('supplierInvoices.kpiDueSoon', { n: s.dueSoon.days }),
      n: s.dueSoon.count,
      amount: total(s.dueSoon.totals),
      tone: 'warning',
    },
    { key: 'needs_review' as const, label: t('supplierInvoices.kpiReview'), n: s.needsReview, amount: '', tone: 'warning' },
  ]
})

const month = computed(() => {
  const s = props.summary
  if (!s) return null
  const [y, m] = s.month.from.split('-').map(Number)
  const tot = s.month.totals[0]
  return {
    label: fmt.monthName(m, y),
    count: s.month.count,
    value: tot ? fmt.amount(tot.totalMinor, tot.currency) : fmt.amount(0, s.unpaid.totals[0]?.currency ?? 'EUR'),
    vat: tot ? fmt.amount(tot.taxMinor, tot.currency) : null,
    auto: s.month.sources.automated,
    manual: s.month.sources.manual,
  }
})
</script>

<template>
  <section class="sis" :aria-label="t('supplierInvoices.summaryTitle')">
    <p v-if="error" class="sis__error">
      <v-icon icon="mdi-alert-circle-outline" size="16" />
      {{ error }}
    </p>
    <v-skeleton-loader v-else-if="!summary" type="list-item-two-line" class="sis__skel" />
    <template v-else>
      <div class="strip" role="group">
        <button
          v-for="c in primary"
          :key="c.key"
          type="button"
          class="kpi"
          :class="[`kpi--${c.tone}`, { 'is-active': c.key === active, 'is-zero': !c.n }]"
          :aria-pressed="c.key === active"
          :title="t('supplierInvoices.kpiFilterHint')"
          @click="emit('pick', c.key)"
        >
          <span class="kpi__label">{{ c.label }}</span>
          <span class="kpi__row">
            <b class="kpi__n">{{ c.n }}</b>
            <span v-if="c.amount && c.n" class="kpi__amt">{{ c.amount }}</span>
          </span>
        </button>
      </div>

      <div v-if="month" class="line">
        <button type="button" class="line__month" @click="emit('pick', 'month')">
          {{ month.label }}
        </button>
        <span>{{ t('supplierInvoices.lineInvoices', { n: month.count }) }}</span>
        <span class="dot" aria-hidden="true">·</span>
        <span>{{ month.value }}</span>
        <template v-if="month.vat">
          <span class="dot" aria-hidden="true">·</span>
          <span>{{ t('supplierInvoices.lineVat', { amount: month.vat }) }} <em>{{ t('supplierInvoices.estimate') }}</em></span>
        </template>
        <span class="dot" aria-hidden="true">·</span>
        <span>{{ t('supplierInvoices.lineSources', { auto: month.auto, manual: month.manual }) }}</span>
        <button type="button" class="line__more" :aria-expanded="showMore" @click="showMore = !showMore">
          {{ showMore ? t('supplierInvoices.less') : t('supplierInvoices.more') }}
          <v-icon :icon="showMore ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="15" />
        </button>
      </div>

      <v-expand-transition>
        <dl v-if="showMore" class="more">
          <div>
            <dt>{{ t('supplierInvoices.vatByRate') }} ({{ month?.label }})</dt>
            <dd>
              <template v-if="summary.month.vatByRate.length">
                <span v-for="r in summary.month.vatByRate" :key="String(r.rate)">
                  {{ r.rate === null ? t('supplierInvoices.rateUnknown') : `${r.rate}%` }}:
                  {{ fmt.amount(r.vatMinor, r.currency) }}
                </span>
              </template>
              <span v-else>-</span>
            </dd>
          </div>
          <div>
            <dt>{{ t('supplierInvoices.statusUnknown') }}</dt>
            <dd>{{ t('supplierInvoices.kpiUnknownPayment', { n: summary.unpaid.unknownPayment }) }}</dd>
          </div>
          <div>
            <dt>{{ t('supplierInvoices.kpiAutomation') }}</dt>
            <dd>{{ t('supplierInvoices.kpiAutomationSub', { auto: summary.sources.automated, manual: summary.sources.manual }) }}</dd>
          </div>
        </dl>
      </v-expand-transition>
    </template>
  </section>
</template>

<style scoped>
.sis {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  container-type: inline-size;
}
.sis__error {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-size: var(--tvz-fs-small);
  color: rgb(var(--v-theme-error));
}
.sis__skel {
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
}
.strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border: 1px solid var(--tvz-glass-border);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  padding: 0.7rem 1rem;
  border: 0;
  border-right: 1px solid var(--tvz-hairline);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.kpi:last-child {
  border-right: 0;
}
.kpi:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.kpi:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}
.kpi.is-active {
  background: rgba(var(--v-theme-primary), 0.08);
  box-shadow: inset 0 -2px 0 rgb(var(--v-theme-primary));
}
.kpi__label {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kpi__row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  min-width: 0;
}
.kpi__n {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.25rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.kpi__amt {
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Colour only on non-zero numbers that need attention. */
.kpi--error:not(.is-zero) .kpi__n {
  color: rgb(var(--v-theme-error));
}
.kpi--warning:not(.is-zero) .kpi__n {
  color: rgb(var(--v-theme-warning));
}
.kpi.is-zero .kpi__n {
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.2rem 0.45rem;
  padding: 0 0.25rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-variant-numeric: tabular-nums;
}
.line em {
  font-style: normal;
  font-size: var(--tvz-fs-micro);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.75;
}
.line__month {
  padding: 0;
  border: 0;
  background: none;
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.line__month:hover {
  text-decoration: underline;
}
.dot {
  opacity: 0.5;
}
.line__more {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
  padding: 0;
  border: 0;
  background: none;
  color: rgb(var(--v-theme-primary));
  font: inherit;
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  cursor: pointer;
}
.more {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.6rem 1.2rem;
  margin: 0;
  padding: 0.7rem 1rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: 10px;
  font-size: var(--tvz-fs-small);
}
.more dt {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.more dd {
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.6rem;
  margin: 0.15rem 0 0;
}

@container (max-width: 640px) {
  .strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .kpi:nth-child(2) {
    border-right: 0;
  }
  .kpi:nth-child(-n + 2) {
    border-bottom: 1px solid var(--tvz-hairline);
  }
  .more {
    grid-template-columns: 1fr;
  }
  .line__more {
    margin-left: 0;
  }
}
</style>
