<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import CreditsValue from '@/components/CreditsValue.vue'
import { useWalletStore, type WalletTxnType } from '@/stores/wallet'
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
const TYPE_TABS = computed(() => [
  { value: null, title: t('transactions.filterAllTypes') },
  ...TYPE_OPTIONS.map((v) => ({ value: v, title: t('wallet.txnType.' + v) })),
])

/** A short, stable per-row reference — the underlying id is a full UUID. */
function shortId(id: string): string {
  return '#' + id.slice(0, 8)
}

async function loadInitial(): Promise<void> {
  loading.value = true
  try {
    await companies.fetchOverview().catch(() => {})
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

// --- Refunds (request itself lives on the Wallet page — this only shows
// history and lets the customer cancel a still-pending one) -------------
const CANCEL_ERR_CODES = ['refund_not_cancelable', 'refund_hold_expired']
function cancelErrorText(err: unknown): string {
  const code = err instanceof ApiError ? err.message : ''
  return CANCEL_ERR_CODES.includes(code) ? t('wallet.err.' + code) : t('admin.genericError')
}

const busyId = ref<string | null>(null)

async function doCancelRefund(refundId: string): Promise<void> {
  busyId.value = refundId
  const ok = await wallet.cancelRefund(refundId)
  busyId.value = null
  if (ok) toasts.success(t('transactions.refundCanceled'))
  else toasts.error(cancelErrorText(new ApiError(0, wallet.error)))
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

    <div class="txn__toolbar">
      <div class="txn__tabs" role="tablist" :aria-label="t('transactions.filterType')">
        <button
          v-for="opt in TYPE_TABS"
          :key="opt.value ?? 'all'"
          type="button"
          role="tab"
          :aria-selected="filterType === opt.value"
          :class="{ 'is-on': filterType === opt.value }"
          @click="filterType = opt.value"
        >
          {{ opt.title }}
        </button>
      </div>
      <div class="txn__toolbarEnd">
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
          class="txn__companyFilter"
        />
        <v-btn v-if="hasFilters" variant="text" size="small" @click="clearFilters">
          {{ t('transactions.clearFilters') }}
        </v-btn>
      </div>
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

        <div v-else class="txn__tableWrap">
          <table class="txn__table">
            <thead>
              <tr>
                <th>{{ t('wallet.colId') }}</th>
                <th>{{ t('wallet.colType') }}</th>
                <th class="num">{{ t('wallet.colAmount') }}</th>
                <th>{{ t('wallet.colDate') }}</th>
                <th>{{ t('wallet.colStatus') }}</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="txn in transactions" :key="txn.id">
                <tr class="trow">
                  <td class="trow__id">{{ shortId(txn.id) }}</td>
                  <td class="trow__type">
                    <span class="trow__icon" :class="{ 'is-in': txn.amount.minor >= 0 }">
                      <v-icon :icon="txnIcon(txn)" size="15" />
                    </span>
                    {{ txnLabel(txn, t) }}
                    <span v-if="txn.clicks != null" class="trow__sub">
                      · {{ t('wallet.nClicks', { n: txn.clicks }) }}
                    </span>
                    <span v-if="txn.companyName" class="trow__sub"> · {{ txn.companyName }}</span>
                  </td>
                  <td class="num">
                    <span class="trow__amount" :class="txn.amount.minor < 0 ? 'is-out' : 'is-in'">
                      <CreditsValue :credits="txn.amount.credits" signed stacked />
                    </span>
                  </td>
                  <td class="trow__date">{{ new Date(txn.createdAt).toLocaleDateString() }}</td>
                  <td>
                    <span class="trow__badge" :class="'trow__badge--' + txn.status">
                      {{ t('wallet.txnStatus.' + txn.status) }}
                    </span>
                  </td>
                </tr>
                <tr v-if="txn.type === 'refund' && txn.status === 'pending'" class="trow__detail">
                  <td colspan="5">
                    <div class="trow__actions">
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
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <button v-if="nextCursor" type="button" class="txn__more" :disabled="loadingMore" @click="loadMore">
          <v-icon icon="mdi-reload" size="15" /> {{ t('wallet.loadMore') }}
        </button>
      </section>
    </template>
  </v-container>
</template>

<style scoped>
.txn {
  max-width: 960px;
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
.txn__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-bottom: 1.1rem;
}
.txn__tabs {
  display: inline-flex;
  flex-wrap: wrap;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 999px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}
.txn__tabs button {
  padding: 0.45rem 1rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  transition:
    background var(--tvz-dur-fast) var(--tvz-ease-out),
    color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.txn__tabs button + button {
  border-left: 1px solid var(--tvz-glass-border);
}
.txn__tabs button.is-on {
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}
.txn__toolbarEnd {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.txn__companyFilter {
  max-width: 220px;
}
.txn__empty {
  padding: 2.5rem 1rem;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.txn__tableWrap {
  overflow-x: auto;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
}
.txn__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.86rem;
}
.txn__table thead th {
  text-align: left;
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.5);
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--tvz-glass-border);
  white-space: nowrap;
}
.txn__table th.num,
.txn__table td.num {
  text-align: right;
}
.txn__table td {
  padding: 0.65rem 1rem;
  vertical-align: middle;
}
.trow + .trow td {
  border-top: 1px solid var(--tvz-hairline);
}
.trow:hover {
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.trow__id {
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), 0.55);
  white-space: nowrap;
}
.trow__type {
  font-weight: 600;
  white-space: nowrap;
}
.trow__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-right: 0.35rem;
  border-radius: 7px;
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
  vertical-align: -6px;
}
.trow__icon.is-in {
  background: rgba(var(--v-theme-success), 0.12);
  color: rgb(var(--v-theme-success));
}
.trow__sub {
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.trow__date {
  white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.trow__amount {
  white-space: nowrap;
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
  white-space: nowrap;
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
.trow__detail td {
  padding: 0 1rem 0.7rem;
  border-top: 0;
}
.trow__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.trow__refundNote {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.txn__more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  width: 100%;
  margin-top: 0.75rem;
  padding: 0.6rem;
  border-radius: var(--tvz-radius-md);
  border: 1px solid var(--tvz-glass-border);
  font-size: 0.82rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.txn__more:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
</style>
