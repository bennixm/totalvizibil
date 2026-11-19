<script setup lang="ts">
/**
 * The dashboard row: eight KPIs computed server-side from stored invoices.
 * Each card that maps to a list filter is a button that applies it, so
 * "12 overdue" is one click away from the 12 invoices. Multi-currency
 * totals are never converted: the largest currency is shown, the rest are
 * listed under it.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { InvoiceSummary } from '@/stores/externalInvoices'

import { useInvoiceFormat } from './useInvoiceFormat'

const props = defineProps<{ summary: InvoiceSummary | null; error: string | null; active: string | null }>()
const emit = defineEmits<{ pick: [key: 'month' | 'unpaid' | 'due_soon' | 'overdue' | 'needs_review'] }>()

const { t } = useI18n()
const fmt = useInvoiceFormat()

function main(rows: { currency: string; totalMinor: number }[]): { value: string; rest: string } {
  if (!rows.length) return { value: '0', rest: '' }
  const [first, ...rest] = rows
  return {
    value: fmt.amount(first.totalMinor, first.currency),
    rest: rest.map((r) => fmt.amount(r.totalMinor, r.currency)).join(' · '),
  }
}

const monthLabel = computed(() => {
  const from = props.summary?.month.from
  if (!from) return ''
  return fmt.monthName(Number(from.slice(5, 7)), Number(from.slice(0, 4)))
})

const cards = computed(() => {
  const s = props.summary
  if (!s) return []
  const monthValue = main(s.month.totals)
  const vat = main(s.month.totals.map((r) => ({ currency: r.currency, totalMinor: r.taxMinor })).filter((r) => r.totalMinor))
  const rates = s.month.vatByRate
    .filter((r) => r.vatMinor)
    .slice(0, 3)
    .map((r) => `${r.rate === null ? t('supplierInvoices.rateUnknown') : `${r.rate}%`}: ${fmt.amount(r.vatMinor, r.currency)}`)
    .join(' · ')
  const unpaid = main(s.unpaid.totals)
  const dueSoon = main(s.dueSoon.totals)
  const overdue = main(s.overdue.totals)
  const auto = s.month.sources.automated
  const manual = s.month.sources.manual
  return [
    {
      key: 'month' as const,
      label: t('supplierInvoices.kpiReceived'),
      value: String(s.month.count),
      sub: monthLabel.value,
      icon: 'mdi-inbox-arrow-down-outline',
      tone: 'neutral',
    },
    {
      key: 'month' as const,
      label: t('supplierInvoices.kpiValue'),
      value: monthValue.value,
      sub: monthValue.rest || monthLabel.value,
      icon: 'mdi-cash-multiple',
      tone: 'neutral',
    },
    {
      key: 'unpaid' as const,
      label: t('supplierInvoices.kpiUnpaid'),
      value: String(s.unpaid.count),
      sub:
        (s.unpaid.count ? unpaid.value : '') +
        (s.unpaid.unknownPayment ? `${s.unpaid.count ? ' · ' : ''}${t('supplierInvoices.kpiUnknownPayment', { n: s.unpaid.unknownPayment })}` : ''),
      icon: 'mdi-clock-outline',
      tone: s.unpaid.count ? 'info' : 'neutral',
    },
    {
      key: 'due_soon' as const,
      label: t('supplierInvoices.kpiDueSoon', { n: s.dueSoon.days }),
      value: String(s.dueSoon.count),
      sub: s.dueSoon.count ? dueSoon.value : t('supplierInvoices.kpiNothing'),
      icon: 'mdi-clock-alert-outline',
      tone: s.dueSoon.count ? 'warning' : 'neutral',
    },
    {
      key: 'overdue' as const,
      label: t('supplierInvoices.kpiOverdue'),
      value: String(s.overdue.count),
      sub: s.overdue.count ? overdue.value : t('supplierInvoices.kpiNothing'),
      icon: 'mdi-alert-circle-outline',
      tone: s.overdue.count ? 'error' : 'neutral',
    },
    {
      key: 'month' as const,
      label: t('supplierInvoices.kpiVat'),
      value: vat.value,
      sub: rates || vat.rest || monthLabel.value,
      icon: 'mdi-percent-outline',
      tone: 'neutral',
      estimate: true,
    },
    {
      key: 'needs_review' as const,
      label: t('supplierInvoices.kpiReview'),
      value: String(s.needsReview),
      sub: s.needsReview ? t('supplierInvoices.kpiReviewSub') : t('supplierInvoices.kpiNothing'),
      icon: 'mdi-eye-check-outline',
      tone: s.needsReview ? 'warning' : 'neutral',
    },
    {
      key: null,
      label: t('supplierInvoices.kpiAutomation'),
      value: `${auto} / ${manual}`,
      sub: t('supplierInvoices.kpiAutomationSub', { auto: s.sources.automated, manual: s.sources.manual }),
      icon: 'mdi-robot-outline',
      tone: 'neutral',
      ratio: auto + manual ? auto / (auto + manual) : 0,
    },
  ]
})
</script>

<template>
  <section class="sis" :aria-label="t('supplierInvoices.summaryTitle')">
    <p v-if="error" class="sis__error">
      <v-icon icon="mdi-alert-circle-outline" size="16" />
      {{ error }}
    </p>
    <div v-else-if="!summary" class="sis__grid">
      <v-skeleton-loader v-for="i in 8" :key="i" type="list-item-two-line" class="sis__skel" />
    </div>
    <div v-else class="sis__grid">
      <component
        :is="c.key ? 'button' : 'div'"
        v-for="(c, i) in cards"
        :key="i"
        :type="c.key ? 'button' : undefined"
        class="kpi"
        :class="[`kpi--${c.tone}`, { 'kpi--link': !!c.key, 'is-active': c.key && c.key === active && c.key !== 'month' }]"
        :aria-pressed="c.key && c.key !== 'month' ? c.key === active : undefined"
        @click="c.key && emit('pick', c.key)"
      >
        <span class="kpi__top">
          <span class="kpi__label">{{ c.label }}</span>
          <v-icon :icon="c.icon" size="17" class="kpi__icon" aria-hidden="true" />
        </span>
        <span class="kpi__value">{{ c.value }}</span>
        <span v-if="c.ratio !== undefined" class="kpi__bar" aria-hidden="true">
          <span :style="{ width: `${Math.round(c.ratio * 100)}%` }" />
        </span>
        <span class="kpi__sub">
          {{ c.sub }}
          <span v-if="c.estimate" class="kpi__est">{{ t('supplierInvoices.estimate') }}</span>
        </span>
      </component>
    </div>
  </section>
</template>

<style scoped>
.sis {
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
.sis__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}
.sis__skel {
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  padding: 0.85rem 0.95rem 0.8rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  color: inherit;
  font: inherit;
  text-align: left;
  transition:
    border-color var(--tvz-dur-fast) var(--tvz-ease-out),
    background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.kpi--link {
  cursor: pointer;
}
.kpi--link:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.22);
}
.kpi--link:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
.kpi.is-active {
  border-color: rgba(var(--v-theme-primary), 0.6);
  background: rgba(var(--v-theme-primary), 0.06);
}
.kpi__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}
.kpi__label {
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.62);
}
.kpi__icon {
  flex-shrink: 0;
  color: rgba(var(--v-theme-on-surface), 0.38);
}
.kpi__value {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.35rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
  overflow-wrap: anywhere;
}
.kpi__sub {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
  overflow-wrap: anywhere;
}
.kpi__est {
  display: inline-block;
  margin-left: 0.25rem;
  padding: 0 0.3rem;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.kpi__bar {
  display: block;
  height: 4px;
  border-radius: 2px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  overflow: hidden;
}
.kpi__bar span {
  display: block;
  height: 100%;
  background: rgb(var(--v-theme-primary));
}
/* Only the number takes the semantic colour; the card stays calm. */
.kpi--warning .kpi__value,
.kpi--warning .kpi__icon {
  color: rgb(var(--v-theme-warning));
}
.kpi--error .kpi__value,
.kpi--error .kpi__icon {
  color: rgb(var(--v-theme-error));
}
.kpi--info .kpi__icon {
  color: rgb(var(--v-theme-info));
}

@container (max-width: 820px) {
  .sis__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@container (max-width: 480px) {
  .sis__grid {
    gap: 0.5rem;
  }
  .kpi {
    padding: 0.65rem 0.7rem;
  }
  .kpi__value {
    font-size: 1.15rem;
  }
}
@container (max-width: 250px) {
  .sis__grid {
    grid-template-columns: 1fr;
  }
}
</style>
