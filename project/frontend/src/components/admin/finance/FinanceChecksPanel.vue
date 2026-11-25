<script setup lang="ts">
/**
 * Data-integrity checks an accountant runs before trusting the figures:
 * duplicate payments, wallet balances that disagree with the ledger,
 * purchases without an invoice, invoice/payment mismatches, Stripe fees
 * never booked, foreign-currency costs without a rate, duplicate manual
 * costs, consumption with no credits behind it, credits removed by admins.
 */
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminHint from '@/components/admin/AdminHint.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import { useMoney } from '@/composables/useMoney'
import { useAdminFinanceStore, type CheckItem, type CheckSeverity } from '@/stores/adminFinance'

const { t } = useI18n()
const finance = useAdminFinanceStore()
const money = useMoney()
const eur = (minor: number) => money.fiat(minor / 100)

const ORDER: Record<CheckSeverity, number> = { error: 0, warning: 1, info: 2, ok: 3 }
const items = computed(() =>
  [...(finance.checks ?? [])].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]),
)
const problems = computed(() => items.value.filter((i) => i.severity === 'error' || i.severity === 'warning').length)

const ICON: Record<CheckSeverity, string> = {
  error: 'mdi-alert-octagon-outline',
  warning: 'mdi-alert-outline',
  info: 'mdi-information-outline',
  ok: 'mdi-check-circle-outline',
}

function summary(c: CheckItem): string {
  if (c.severity === 'ok') return t('adminFinance.checks.ok')
  return c.amountMinor === null
    ? t('adminFinance.checks.count', { n: c.count })
    : t('adminFinance.checks.countAmount', { n: c.count, amount: eur(c.amountMinor) })
}

onMounted(() => {
  if (!finance.checks) void finance.fetchChecks()
})
</script>

<template>
  <div class="fcp">
    <div class="fcp__bar">
      <span v-if="finance.checks" class="fcp__status" :class="problems ? 'is-bad' : 'is-good'">
        <v-icon :icon="problems ? 'mdi-alert-outline' : 'mdi-shield-check-outline'" size="18" />
        {{ problems ? t('adminFinance.checks.problems', { n: problems }) : t('adminFinance.checks.allGood') }}
      </span>
      <AdminHint :text="t('adminFinance.checks.lead')" />
      <v-spacer />
      <small v-if="finance.checksGeneratedAt" class="fcp__time">
        {{ new Date(finance.checksGeneratedAt).toLocaleString('ro-RO') }}
      </small>
      <v-btn
        variant="tonal"
        size="small"
        prepend-icon="mdi-refresh"
        :loading="finance.loadingChecks"
        @click="finance.fetchChecks()"
      >
        {{ t('adminFinance.checks.rerun') }}
      </v-btn>
    </div>

    <div v-if="finance.loadingChecks && !finance.checks" class="fcp__center">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <AdminEmptyState v-else-if="finance.checksError" icon="mdi-alert-circle-outline" :text="finance.checksError" />

    <ul v-else class="fcp__list">
      <li v-for="c in items" :key="c.key" class="fcp__item" :class="`is-${c.severity}`">
        <details :open="c.severity === 'error'">
          <summary>
            <v-icon :icon="ICON[c.severity]" size="20" class="fcp__icon" />
            <span class="fcp__title">
              <b>{{ t(`adminFinance.checks.items.${c.key}.title`) }}</b>
              <small>{{ t(`adminFinance.checks.items.${c.key}.desc`) }}</small>
            </span>
            <span class="fcp__sum">{{ summary(c) }}</span>
          </summary>
          <div v-if="c.samples.length" class="fcp__samples">
            <div v-for="(s, i) in c.samples" :key="i" class="fcp__sample">
              <span class="fcp__slabel">{{ s.label }}</span>
              <span class="fcp__sdetail">{{ s.detail }}</span>
              <span class="fcp__samount">{{ s.amountMinor !== undefined ? eur(s.amountMinor) : '' }}</span>
            </div>
            <small v-if="c.count > c.samples.length" class="fcp__more">
              {{ t('adminFinance.checks.more', { n: c.count - c.samples.length }) }}
            </small>
          </div>
        </details>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.fcp__bar {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  flex-wrap: wrap;
}
.fcp__status {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-weight: 700;
  font-size: var(--tvz-fs-section);
}
.fcp__status.is-bad {
  color: rgb(var(--v-theme-warning));
}
.fcp__status.is-good {
  color: rgb(var(--v-theme-success));
}
.fcp__time {
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.fcp__lead {
  margin: 0.5rem 0 1rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.fcp__center {
  display: grid;
  place-items: center;
  min-height: 160px;
}
.fcp__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.fcp__item {
  border: 1px solid var(--tvz-glass-border);
  border-left-width: 3px;
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
}
.fcp__item.is-error {
  border-left-color: rgb(var(--v-theme-error));
}
.fcp__item.is-warning {
  border-left-color: rgb(var(--v-theme-warning));
}
.fcp__item.is-info {
  border-left-color: rgb(var(--v-theme-info));
}
.fcp__item.is-ok {
  border-left-color: rgb(var(--v-theme-success));
}
.fcp__item summary {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.75rem 0.9rem;
  cursor: pointer;
  list-style: none;
}
.fcp__item summary::-webkit-details-marker {
  display: none;
}
.is-error .fcp__icon {
  color: rgb(var(--v-theme-error));
}
.is-warning .fcp__icon {
  color: rgb(var(--v-theme-warning));
}
.is-info .fcp__icon {
  color: rgb(var(--v-theme-info));
}
.is-ok .fcp__icon {
  color: rgb(var(--v-theme-success));
}
.fcp__title {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.fcp__title b {
  font-size: var(--tvz-fs-body);
}
.fcp__title small {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.fcp__sum {
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.fcp__samples {
  padding: 0 0.9rem 0.8rem 2.6rem;
}
.fcp__sample {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto;
  gap: 0.8rem;
  padding: 0.35rem 0;
  border-top: 1px dashed var(--tvz-hairline);
  font-size: var(--tvz-fs-small);
}
.fcp__slabel {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, monospace;
}
.fcp__sdetail {
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.fcp__samount {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.fcp__more {
  color: rgba(var(--v-theme-on-surface), 0.5);
}
@media (max-width: 600px) {
  .fcp__item summary {
    flex-wrap: wrap;
  }
  .fcp__sum {
    width: 100%;
    padding-left: 2rem;
  }
  .fcp__samples {
    padding-left: 0.9rem;
  }
  .fcp__sample {
    grid-template-columns: 1fr;
    gap: 0.1rem;
  }
}
</style>
