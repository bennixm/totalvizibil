<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import CreditsValue from '@/components/CreditsValue.vue'
import { useWalletStore, type WalletTxn, type WalletTxnType } from '@/stores/wallet'
import { useCompaniesStore } from '@/stores/companies'
import { useToastStore } from '@/stores/toast'
import { ApiError } from '@/services/api'
import { txnLabel, txnIcon } from '@/composables/useTxnLabel'

const { t } = useI18n()
const wallet = useWalletStore()
const companies = useCompaniesStore()
const toasts = useToastStore()
const { transactions, nextCursor } = storeToRefs(wallet)
const { overview } = storeToRefs(companies)

// `loadTransactions()` doesn't manage its own loading flags (its other two
// callers — `wallet.load()`/`confirmPending()` — already wrap it in their
// OWN loading state, so it isn't meant to be called standalone). The
// store's shared `loading`/`working` flags this view used to read are only
// ever toggled by those OTHER actions — never by `loadTransactions()` — so
// on a normal visit here they're already back to `false` from whatever
// finished on a previous page, and the list flashed as "empty" every time
// before the real data replaced it a moment later. Local flags instead.
const loading = ref(true)
const loadingMore = ref(false)

const filterCompany = ref<string | null>(null)
const filterType = ref<WalletTxnType | null>(null)
const hasFilters = computed(() => !!filterCompany.value || !!filterType.value)

const TYPE_OPTIONS: WalletTxnType[] = ['purchase', 'spend', 'refund', 'adjustment']

async function loadInitial(): Promise<void> {
  loading.value = true
  try {
    await Promise.all([
      companies.fetchOverview().catch(() => {}),
      wallet.ensureSummary().catch(() => {}),
    ])
    await wallet.loadTransactions(false, { companyId: filterCompany.value, type: filterType.value })
  } catch {
    toasts.error(t('wallet.historyError'))
  } finally {
    loading.value = false
  }
}

async function loadMore(): Promise<void> {
  if (loadingMore.value || !nextCursor.value) return
  loadingMore.value = true
  try {
    await wallet.loadTransactions(true)
  } catch {
    toasts.error(t('wallet.historyError'))
  } finally {
    loadingMore.value = false
  }
}

function clearFilters(): void {
  filterCompany.value = null
  filterType.value = null
}

watch([filterCompany, filterType], async () => {
  loading.value = true
  try {
    await wallet.loadTransactions(false, { companyId: filterCompany.value, type: filterType.value })
  } catch {
    toasts.error(t('wallet.historyError'))
  } finally {
    loading.value = false
  }
})

onMounted(loadInitial)

// --- Refunds ---------------------------------------------------------
const REFUND_ERR_CODES = [
  'purchase_not_refundable',
  'only_completed_purchases_can_be_refunded',
  'refund_already_requested',
  'insufficient_balance_for_refund',
  'refund_not_cancelable',
  'refund_hold_expired',
]
function refundErrorText(err: unknown): string {
  const code = err instanceof ApiError ? err.message : ''
  return REFUND_ERR_CODES.includes(code) ? t('wallet.err.' + code) : t('admin.genericError')
}

const refundTarget = ref<WalletTxn | null>(null)
const refundFeePct = computed(() => wallet.summary?.refundFeePct ?? 0)
const refundFeeCredits = computed(() =>
  refundTarget.value ? (refundTarget.value.amount.credits * refundFeePct.value) / 100 : 0,
)
const busyId = ref<string | null>(null)

function askRefund(txn: WalletTxn): void {
  refundTarget.value = txn
}

async function confirmRefund(): Promise<void> {
  if (!refundTarget.value) return
  const id = refundTarget.value.id
  busyId.value = id
  const ok = await wallet.requestRefund(id)
  busyId.value = null
  refundTarget.value = null
  if (ok) toasts.success(t('transactions.refundRequested'))
  else toasts.error(refundErrorText(new ApiError(0, wallet.error)))
}

async function doCancelRefund(refundId: string): Promise<void> {
  busyId.value = refundId
  const ok = await wallet.cancelRefund(refundId)
  busyId.value = null
  if (ok) toasts.success(t('transactions.refundCanceled'))
  else toasts.error(refundErrorText(new ApiError(0, wallet.error)))
}

function daysLeft(processAt: string): number {
  return Math.max(0, Math.ceil((new Date(processAt).getTime() - Date.now()) / 86_400_000))
}
</script>

<template>
  <v-container class="txn">
    <header class="txn__head">
      <div>
        <p class="txn__eyebrow">{{ t('transactions.eyebrow') }}</p>
        <h1>{{ t('transactions.title') }}</h1>
      </div>
      <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" :to="{ name: 'wallet' }">
        {{ t('transactions.back') }}
      </v-btn>
    </header>

    <div class="txn__filters">
      <v-select
        v-if="overview.length > 1"
        v-model="filterCompany"
        :items="[
          { title: t('transactions.filterAllBusinesses'), value: null },
          ...overview.map((c) => ({ title: c.displayName, value: c.id })),
        ]"
        :label="t('transactions.filterBusiness')"
        density="compact"
        variant="outlined"
        hide-details
        class="txn__filter"
      />
      <v-select
        v-model="filterType"
        :items="[
          { title: t('transactions.filterAllTypes'), value: null },
          ...TYPE_OPTIONS.map((v) => ({ title: t('wallet.txnType.' + v), value: v })),
        ]"
        :label="t('transactions.filterType')"
        density="compact"
        variant="outlined"
        hide-details
        class="txn__filter"
      />
      <v-btn v-if="hasFilters" variant="text" size="small" @click="clearFilters">
        {{ t('transactions.clearFilters') }}
      </v-btn>
    </div>

    <div v-if="loading && !transactions.length" class="txn__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else>
      <section class="txn__list">
        <p v-if="!transactions.length && hasFilters" class="txn__empty">
          {{ t('transactions.noneMatch') }}
        </p>
        <p v-else-if="!transactions.length" class="txn__empty">{{ t('wallet.historyEmpty') }}</p>

        <ul v-else class="txn__rows">
          <li v-for="txn in transactions" :key="txn.id" class="trow">
            <div class="trow__top">
              <span class="trow__icon" :class="{ 'is-in': txn.amount.minor >= 0 }">
                <v-icon :icon="txnIcon(txn)" size="18" />
              </span>
              <div class="trow__main">
                <p class="trow__label">
                  {{ txnLabel(txn, t) }}
                  <span v-if="txn.clicks != null" class="trow__sub">
                    · {{ t('wallet.nClicks', { n: txn.clicks }) }}
                  </span>
                  <span v-if="txn.companyName" class="trow__sub"> · {{ txn.companyName }}</span>
                </p>
                <p class="trow__date">{{ new Date(txn.createdAt).toLocaleDateString() }}</p>
              </div>
              <div class="trow__end">
                <span class="trow__amount" :class="txn.amount.minor < 0 ? 'is-out' : 'is-in'">
                  <CreditsValue :credits="txn.amount.credits" signed stacked />
                </span>
                <span class="trow__badge" :class="'trow__badge--' + txn.status">
                  {{ t('wallet.txnStatus.' + txn.status) }}
                </span>
              </div>
            </div>

            <div v-if="txn.type === 'purchase' && txn.refundEligible" class="trow__actions">
              <v-btn
                size="x-small"
                variant="text"
                prepend-icon="mdi-cash-refund"
                @click="askRefund(txn)"
              >
                {{ t('transactions.requestRefund') }}
              </v-btn>
            </div>
            <div
              v-else-if="txn.type === 'refund' && txn.status === 'pending'"
              class="trow__actions trow__actions--pending"
            >
              <span class="trow__refundNote">
                <v-icon icon="mdi-clock-outline" size="13" />
                {{ t('transactions.refundProcessesIn', { d: txn.processAt ? daysLeft(txn.processAt) : 0 }) }}
                <template v-if="txn.feeMinor">
                  · {{ t('transactions.refundFeeNote', { fee: txn.feeMinor.credits }) }}
                </template>
              </span>
              <v-btn
                size="x-small"
                variant="tonal"
                color="warning"
                :loading="busyId === txn.id"
                @click="doCancelRefund(txn.id)"
              >
                {{ t('common.cancel') }}
              </v-btn>
            </div>
          </li>
        </ul>

        <v-btn
          v-if="nextCursor"
          variant="text"
          size="small"
          :loading="loadingMore"
          @click="loadMore"
        >
          {{ t('wallet.loadMore') }}
        </v-btn>
      </section>
    </template>

    <v-dialog :model-value="!!refundTarget" max-width="440" @update:model-value="refundTarget = null">
      <v-card v-if="refundTarget">
        <v-card-title class="text-h6">{{ t('transactions.confirmRefundTitle') }}</v-card-title>
        <v-card-text>
          <p>{{ t('transactions.confirmRefundText', { credits: refundTarget.amount.credits }) }}</p>
          <p v-if="refundFeePct > 0" class="txn__feeNote">
            {{ t('transactions.confirmRefundFee', { pct: refundFeePct, fee: refundFeeCredits }) }}
          </p>
          <p class="txn__holdNote">{{ t('transactions.confirmRefundHold') }}</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="busyId === refundTarget.id" @click="refundTarget = null">
            {{ t('common.cancel') }}
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="busyId === refundTarget.id"
            @click="confirmRefund"
          >
            {{ t('transactions.confirmRefundCta') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.txn {
  max-width: 780px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.txn__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.txn__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.25rem;
}
.txn__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin: 0 0 0.3rem;
}
.txn__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.5rem, 4vw, 2.1rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.txn__filters {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-bottom: 1.1rem;
}
.txn__filter {
  max-width: 220px;
}
.txn__empty {
  padding: 2.5rem 1rem;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.txn__rows {
  list-style: none;
  margin: 0 0 0.75rem;
  padding: 0;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}
.trow {
  padding: 0.75rem 1rem;
}
.trow + .trow {
  border-top: 1px solid var(--tvz-hairline);
}
.trow__top {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.trow__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.4rem;
}
.trow__actions--pending {
  justify-content: space-between;
}
.trow__refundNote {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.trow__icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
}
.trow__icon.is-in {
  background: rgba(var(--v-theme-success), 0.12);
  color: rgb(var(--v-theme-success));
}
.trow__main {
  flex: 1;
  min-width: 0;
}
.trow__label {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.trow__sub {
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.trow__date {
  margin: 0.1rem 0 0;
  font-size: 0.76rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.trow__end {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.25rem;
}
.trow__amount.is-in {
  color: rgb(var(--v-theme-success));
  font-weight: 600;
}
.trow__amount.is-out {
  color: rgb(var(--v-theme-error));
  font-weight: 600;
}
.trow__badge {
  font-size: 0.68rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.trow__badge--completed {
  background: rgba(var(--v-theme-success), 0.16);
  color: rgb(var(--v-theme-success));
}
.trow__badge--pending {
  background: rgba(var(--v-theme-warning), 0.16);
  color: rgb(var(--v-theme-warning));
}
.trow__badge--failed {
  background: rgba(var(--v-theme-error), 0.16);
  color: rgb(var(--v-theme-error));
}
.txn__feeNote {
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.txn__holdNote {
  margin: 0.6rem 0 0;
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
</style>
