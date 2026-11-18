<script setup lang="ts">
/**
 * The profit and loss statement, laid out the way an accountant reads it:
 * cash (with the VAT that belongs to the state split out), earned revenue
 * per service line, expenses, result, non-cash items and the customer
 * advances still owed. The same lines, in the same order, as the PDF / Excel
 * / CSV report exports (backend `statementLines`).
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useMoney } from '@/composables/useMoney'
import type {
  BalanceSnapshot,
  ExpenseCategory,
  FinancialStatement,
  MissingInfo,
} from '@/stores/adminFinance'

const props = defineProps<{
  statement: FinancialStatement
  balance?: BalanceSnapshot | null
}>()

const { t } = useI18n()
const money = useMoney()
const eur = (minor: number) => money.fiat(minor / 100)

interface Line {
  key: string
  label: string
  amount?: number
  text?: string
  kind?: 'head' | 'total' | 'sub' | 'grand'
  hint?: string
}

const EXPENSE_KEYS: ExpenseCategory[] = [
  'hosting',
  'call_center',
  'cloud_storage',
  'domains',
  'google_ads',
  'stripe_fees',
  'other',
]
const CAT_LABEL: Record<ExpenseCategory, string> = {
  hosting: 'adminFinance.catHosting',
  call_center: 'adminFinance.catCallCenter',
  cloud_storage: 'adminFinance.catCloudStorage',
  domains: 'adminFinance.catDomains',
  google_ads: 'adminFinance.catGoogleAds',
  stripe_fees: 'adminFinance.catStripeFees',
  other: 'adminFinance.catOther',
}

const lines = computed<Line[]>(() => {
  const s = props.statement
  const L: Line[] = []
  const p = (k: string, params: Record<string, unknown> = {}) => t(`adminFinance.pl.${k}`, params)

  L.push({ key: 'h1', label: p('cashHead'), kind: 'head' })
  L.push({ key: 'collected', label: p('collected', { n: s.cash.purchaseCount }), amount: s.cash.collectedMinor })
  L.push({ key: 'refunded', label: p('refunded', { n: s.cash.refundCount }), amount: 0 - s.cash.refundedMinor })
  L.push({ key: 'net', label: p('cashNet'), amount: s.cash.netMinor, kind: 'total' })
  L.push({ key: 'vat', label: p('cashVat'), amount: s.cash.netVatMinor, kind: 'sub', hint: p('cashVatHint') })
  L.push({ key: 'netEx', label: p('cashNetExVat'), amount: s.cash.netExVatMinor, kind: 'total' })
  if (s.cash.vatUnknownMinor !== 0) {
    L.push({ key: 'vatUnknown', label: p('cashVatUnknown'), amount: s.cash.vatUnknownMinor, kind: 'sub' })
  }
  L.push({ key: 'face', label: p('faceValue'), amount: s.cash.faceValueSoldMinor, kind: 'sub' })
  L.push({ key: 'discount', label: p('discount'), amount: s.cash.discountMinor, kind: 'sub' })

  L.push({ key: 'h2', label: p('revenueHead'), kind: 'head', hint: p('revenueHint') })
  L.push({ key: 'cpc', label: p('revCpc'), amount: s.revenue.byCategory.cpc })
  L.push({ key: 'ai', label: p('revAi'), amount: s.revenue.byCategory.aiUsage })
  L.push({ key: 'unlock', label: p('revUnlock'), amount: s.revenue.byCategory.builderUnlock })
  L.push({ key: 'other', label: p('revOther'), amount: s.revenue.byCategory.other })
  L.push({ key: 'fees', label: p('revRefundFees'), amount: s.revenue.refundFeesMinor })
  L.push({ key: 'revTotal', label: p('revTotal'), amount: s.revenue.totalNetMinor, kind: 'total' })
  L.push({ key: 'revVat', label: p('revVat'), amount: s.revenue.totalVatMinor, kind: 'sub' })

  L.push({ key: 'h3', label: p('expensesHead'), kind: 'head' })
  for (const k of EXPENSE_KEYS) L.push({ key: `e-${k}`, label: t(CAT_LABEL[k]), amount: s.expenses.byCategory[k] })
  L.push({ key: 'aiB', label: p('aiBuilder'), amount: s.expenses.ai.builderMinor })
  L.push({ key: 'aiA', label: p('aiAgent'), amount: s.expenses.ai.campaignAgentMinor })
  L.push({ key: 'aiS', label: p('aiSearch'), amount: s.expenses.ai.searchMinor })
  L.push({ key: 'expTotal', label: p('expensesTotal'), amount: s.expenses.totalMinor, kind: 'total' })

  L.push({ key: 'h4', label: p('resultHead'), kind: 'head' })
  L.push({
    key: 'profit',
    label: p('operatingProfit'),
    amount: s.result.operatingProfitMinor,
    kind: 'grand',
    hint: p('operatingProfitHint'),
  })
  L.push({
    key: 'margin',
    label: p('margin'),
    text: s.result.marginPct === null ? '-' : `${s.result.marginPct.toLocaleString('ro-RO')}%`,
    kind: 'sub',
  })
  L.push({ key: 'cashRes', label: p('cashResult'), amount: s.result.cashResultMinor, hint: p('cashResultHint') })

  L.push({ key: 'h5', label: p('nonCashHead'), kind: 'head', hint: p('nonCashHint') })
  L.push({ key: 'free', label: p('freeConsumed'), amount: s.nonCash.freeCreditsConsumedMinor })
  L.push({ key: 'voided', label: p('voidedConsumed'), amount: s.nonCash.voidedCreditsConsumedMinor })
  L.push({ key: 'forfeit', label: p('forfeited'), amount: s.nonCash.forfeitedCreditsMinor })

  const b = props.balance
  if (b) {
    L.push({
      key: 'h6',
      label: p('balanceHead', { date: new Date(b.asOf).toLocaleDateString('ro-RO') }),
      kind: 'head',
      hint: p('balanceHint'),
    })
    L.push({ key: 'adv', label: p('advances'), amount: b.advancesMoneyMinor, kind: 'total' })
    L.push({ key: 'advVat', label: p('advancesVat'), amount: b.advancesVatMinor, kind: 'sub' })
    L.push({ key: 'paidLeft', label: p('unconsumedPaid'), amount: b.unconsumedPaidCreditsMinor, kind: 'sub' })
    L.push({ key: 'freeLeft', label: p('unconsumedFree'), amount: b.unconsumedFreeCreditsMinor, kind: 'sub' })
  }
  return L
})

function missingText(m: MissingInfo): string {
  return t(`adminFinance.missing.${m.key}`, {
    n: m.count ?? 0,
    amount: eur(m.amountMinor ?? 0),
  })
}
</script>

<template>
  <div class="fst">
    <table class="fst__table">
      <tbody>
        <tr v-for="l in lines" :key="l.key" :class="l.kind ? `fst--${l.kind}` : ''">
          <th scope="row">
            {{ l.label }}
            <v-tooltip v-if="l.hint" :text="l.hint" location="top" max-width="340">
              <template #activator="{ props: tip }">
                <v-icon v-bind="tip" icon="mdi-information-outline" size="14" class="fst__hint" />
              </template>
            </v-tooltip>
          </th>
          <td>
            <template v-if="l.amount !== undefined">{{ eur(l.amount) }}</template>
            <template v-else-if="l.text">{{ l.text }}</template>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="statement.missing.length" class="fst__missing">
      <div class="fst__missinghead">
        <v-icon icon="mdi-clipboard-alert-outline" size="18" />
        {{ t('adminFinance.missingTitle') }}
      </div>
      <ul>
        <li v-for="m in statement.missing" :key="m.key" :class="`fst__m--${m.key}`">
          {{ missingText(m) }}
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.fst__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--tvz-fs-body);
}
.fst__table th,
.fst__table td {
  padding: 0.5rem 0.25rem;
  border-bottom: 1px dashed var(--tvz-hairline);
  text-align: left;
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.fst__table td {
  text-align: right;
  white-space: nowrap;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.fst--head th {
  padding-top: 1.1rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgb(var(--v-theme-primary));
  border-bottom: 1px solid var(--tvz-hairline);
}
.fst--total th,
.fst--total td {
  font-weight: 700;
  color: rgb(var(--v-theme-on-surface));
  border-bottom: 1px solid var(--tvz-hairline);
}
.fst--grand th,
.fst--grand td {
  font-weight: 800;
  font-size: var(--tvz-fs-lead);
  color: rgb(var(--v-theme-on-surface));
  background: rgba(var(--v-theme-primary), 0.06);
}
.fst--sub th {
  padding-left: 1.1rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.fst--sub td {
  font-size: var(--tvz-fs-small);
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.fst__hint {
  margin-left: 0.25rem;
  opacity: 0.55;
  vertical-align: -2px;
}
.fst__missing {
  margin-top: 1.2rem;
  padding: 0.9rem 1rem;
  border-radius: var(--tvz-radius-md);
  border: 1px solid rgba(var(--v-theme-warning), 0.35);
  background: rgba(var(--v-theme-warning), 0.06);
}
.fst__missinghead {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 700;
  font-size: var(--tvz-fs-body);
  margin-bottom: 0.4rem;
}
.fst__missing ul {
  margin: 0;
  padding-left: 1.2rem;
  font-size: var(--tvz-fs-small);
  line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.fst__missing li + li {
  margin-top: 0.3rem;
}
@media (max-width: 600px) {
  .fst__table th {
    font-size: var(--tvz-fs-small);
  }
}
</style>
