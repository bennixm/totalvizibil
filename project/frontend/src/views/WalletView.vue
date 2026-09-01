<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import CreditsValue from '@/components/CreditsValue.vue'
import InfoHint from '@/components/InfoHint.vue'
import { useMoney } from '@/composables/useMoney'
import { useCompaniesStore } from '@/stores/companies'
import { useWalletStore } from '@/stores/wallet'

const { t, n } = useI18n()
const companies = useCompaniesStore()
const wallet = useWalletStore()
const money = useMoney()
const { summary, transactions, nextCursor, pending, loading, working, error } = storeToRefs(wallet)
const { overview } = storeToRefs(companies)

const CURRENCIES = ['EUR', 'RON'] as const

const KNOWN_ERRORS = ['wallet_blocked', 'insufficient_credits']
const errorText = computed<string>(() => {
  const code = error.value
  if (!code) return ''
  if (code === 'wallet_blocked') {
    return wallet.errorReason
      ? t('wallet.err.wallet_blocked_reason', { reason: wallet.errorReason })
      : t('wallet.err.wallet_blocked')
  }
  return KNOWN_ERRORS.includes(code) ? t('wallet.err.' + code) : code
})

const PRESETS = [10, 25, 50, 100]
const amount = ref(50)

const rate = computed(() => summary.value?.eurRonRate ?? 5.05)
const consumers = computed(() => overview.value.filter((c) => c.consumedCredits > 0))

function eur(v: number): string {
  return '€' + n(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function ron(eurValue: number): string {
  return n(eurValue * rate.value, { maximumFractionDigits: 0 }) + ' RON'
}
function credits(v: number): string {
  return n(v, { maximumFractionDigits: 2 })
}

const previewValid = computed(() => Number.isInteger(amount.value) && amount.value >= 1)

async function buy(): Promise<void> {
  if (!previewValid.value) return
  await wallet.startPurchase(amount.value)
}
async function confirm(): Promise<void> {
  await wallet.confirmPending()
}

onMounted(async () => {
  await Promise.all([wallet.load(), companies.fetchOverview().catch(() => {})])
})
</script>

<template>
  <v-container class="wal">
    <header class="wal__head">
      <div>
        <p class="wal__eyebrow">{{ t('wallet.eyebrow') }}</p>
        <h1>{{ t('wallet.title') }}</h1>
      </div>
      <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" :to="{ name: 'dashboard' }">
        {{ t('wallet.backToDashboard') }}
      </v-btn>
    </header>

    <div v-if="loading" class="wal__center"><v-progress-circular indeterminate color="primary" /></div>

    <template v-else-if="summary">
      <!-- Balance -->
      <section class="wal__balance">
        <p class="wal__balanceLabel">
          {{ t('wallet.balance') }}
          <InfoHint
            :text="`${t('wallet.mainNote')} ${t('wallet.rateNote', { rate: n(rate, { maximumFractionDigits: 4 }) })}`"
          />
        </p>
        <p class="wal__balanceValue">
          {{ credits(summary.balance.credits) }} <span>{{ t('wallet.credits') }}</span>
        </p>
        <p class="wal__balanceEq">{{ money.approx(summary.balance.credits) }}</p>

        <div class="wal__currency" role="group" :aria-label="t('wallet.currencyLabel')">
          <span class="wal__currencyLabel">{{ t('wallet.currencyLabel') }}</span>
          <div class="wal__currencyBtns">
            <button
              v-for="c in CURRENCIES"
              :key="c"
              type="button"
              :class="{ 'is-on': summary.currency === c }"
              :disabled="working"
              @click="wallet.setCurrency(c)"
            >
              {{ t('wallet.currency' + c) }}
            </button>
          </div>
        </div>
      </section>

      <div class="wal__stats">
        <div>
          <span>{{ t('wallet.deposited') }}</span>
          <strong>{{ eur(summary.depositedEurCents / 100) }}</strong>
        </div>
        <div>
          <span>{{ t('wallet.purchased') }}</span>
          <strong>{{ credits(summary.purchased.credits) }}</strong>
          <em class="wal__statEq">{{ money.approx(summary.purchased.credits) }}</em>
        </div>
        <div>
          <span>{{ t('wallet.spent') }}</span>
          <strong>{{ credits(summary.spent.credits) }}</strong>
          <em class="wal__statEq">{{ money.approx(summary.spent.credits) }}</em>
        </div>
      </div>

      <!-- Buy credits -->
      <section class="wal__buy">
        <h2>
          {{ t('wallet.buyTitle') }}
          <InfoHint :text="t('wallet.prepaidNote')" />
        </h2>

        <div v-if="summary?.blocked" class="wal__blocked">
          <v-icon icon="mdi-lock" size="18" />
          <div>
            <strong>{{ t('wallet.err.wallet_blocked') }}</strong>
            <p v-if="summary.blockedReason">{{ t('wallet.blockedReason', { reason: summary.blockedReason }) }}</p>
            <p>{{ t('wallet.blockedHelp') }}</p>
          </div>
        </div>

        <div v-else-if="!pending" class="wal__buyForm">
          <div class="wal__presets">
            <button
              v-for="p in PRESETS"
              :key="p"
              type="button"
              :class="{ 'is-on': amount === p }"
              @click="amount = p"
            >
              {{ p }}
            </button>
            <v-text-field
              v-model.number="amount"
              type="number"
              :min="1"
              density="compact"
              variant="outlined"
              hide-details
              class="wal__custom"
              :label="t('wallet.customAmount')"
            />
          </div>
          <p class="wal__preview">
            {{ t('wallet.previewLine', { credits: amount || 0, eur: eur(amount || 0), ron: ron(amount || 0) }) }}
          </p>
          <v-btn
            color="primary"
            :disabled="!previewValid"
            :loading="working"
            append-icon="mdi-arrow-right"
            @click="buy"
          >
            {{ t('wallet.buyCta') }}
          </v-btn>
        </div>

        <!-- Stub payment confirm -->
        <div v-else class="wal__confirm">
          <p class="wal__confirmHead">
            <v-icon icon="mdi-credit-card-outline" size="18" /> {{ t('wallet.confirmTitle') }}
          </p>
          <p class="wal__confirmSum">
            {{ t('wallet.previewLine', {
              credits: pending.credits,
              eur: eur(pending.eurCents / 100),
              ron: (pending.ronBani / 100).toLocaleString() + ' RON',
            }) }}
          </p>
          <p class="wal__devNote">{{ t('wallet.devNote') }}</p>
          <div class="wal__confirmActions">
            <v-btn variant="text" :disabled="working" @click="wallet.cancelPending()">
              {{ t('common.cancel') }}
            </v-btn>
            <v-btn color="primary" :loading="working" @click="confirm">
              {{ t('wallet.confirmCta') }}
            </v-btn>
          </div>
        </div>
      </section>

      <div v-if="error" class="wal__error">
        <v-icon icon="mdi-alert-circle-outline" size="18" /> {{ errorText }}
      </div>

      <!-- Consumption per business -->
      <section v-if="consumers.length" class="wal__bybiz">
        <h2>{{ t('wallet.byBusinessTitle') }}</h2>
        <ul>
          <li v-for="c in consumers" :key="c.id">
            <span class="wal__bybizName">{{ c.displayName }}</span>
            <span class="wal__bybizVal"><CreditsValue :credits="c.consumedCredits" /></span>
          </li>
        </ul>
      </section>

      <!-- History -->
      <section class="wal__history">
        <h2>{{ t('wallet.historyTitle') }}</h2>
        <p v-if="!transactions.length" class="wal__muted">{{ t('wallet.historyEmpty') }}</p>
        <table v-else class="wal__table">
          <thead>
            <tr>
              <th>{{ t('wallet.colType') }}</th>
              <th>{{ t('wallet.colAmount') }}</th>
              <th>{{ t('wallet.colStatus') }}</th>
              <th>{{ t('wallet.colDate') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="txn in transactions" :key="txn.id">
              <td>
                {{ txn.clicks != null ? t('wallet.adClicks') : t('wallet.txnType.' + txn.type) }}
                <span v-if="txn.clicks != null" class="wal__txnBiz">
                  · {{ t('wallet.nClicks', { n: txn.clicks }) }}
                </span>
                <span v-if="txn.companyName" class="wal__txnBiz">· {{ txn.companyName }}</span>
              </td>
              <td :class="txn.amount.minor < 0 ? 'is-out' : 'is-in'">
                <CreditsValue :credits="txn.amount.credits" signed stacked />
              </td>
              <td>
                <span class="wal__badge" :class="'wal__badge--' + txn.status">
                  {{ t('wallet.txnStatus.' + txn.status) }}
                </span>
              </td>
              <td>{{ new Date(txn.createdAt).toLocaleDateString() }}</td>
            </tr>
          </tbody>
        </table>
        <v-btn
          v-if="nextCursor"
          variant="text"
          size="small"
          :loading="working"
          @click="wallet.loadTransactions(true)"
        >
          {{ t('wallet.loadMore') }}
        </v-btn>
      </section>
    </template>
  </v-container>
</template>

<style scoped>
.wal {
  max-width: 780px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.wal__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.wal__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.wal__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.45);
  margin: 0 0 0.3rem;
}
.wal__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.5rem, 4vw, 2.1rem);
  letter-spacing: -0.02em;
  margin: 0;
}

.wal__balance {
  padding: 1.5rem;
  border-radius: var(--tvz-radius-lg);
  border: 1px solid var(--tvz-glass-border);
  background: var(--tvz-ai-soft);
  text-align: center;
}
.wal__balanceLabel {
  margin: 0;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.wal__balanceValue {
  margin: 0.3rem 0 0.2rem;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(2rem, 6vw, 3rem);
  line-height: 1;
}
.wal__balanceValue span {
  font-size: 0.9rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.wal__balanceEq {
  margin: 0;
  color: rgb(var(--v-theme-on-surface) / 0.7);
}
.wal__currency {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-top: 1rem;
}
.wal__currencyLabel {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.wal__currencyBtns {
  display: inline-flex;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 999px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}
.wal__currencyBtns button {
  padding: 0.35rem 1rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.6);
  transition:
    background var(--tvz-dur-fast) var(--tvz-ease-out),
    color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.wal__currencyBtns button + button {
  border-left: 1px solid var(--tvz-glass-border);
}
.wal__currencyBtns button.is-on {
  background: rgb(var(--v-theme-primary) / 0.14);
  color: rgb(var(--v-theme-primary));
}
.wal__currencyBtns button:disabled {
  opacity: 0.5;
}

.wal__bybiz {
  margin-top: 1.75rem;
}
.wal__bybiz h2 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.1rem;
  margin: 0 0 0.75rem;
}
.wal__bybiz ul {
  list-style: none;
  padding: 0;
  margin: 0;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-md);
  overflow: hidden;
}
.wal__bybiz li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.7rem 1rem;
  font-size: 0.9rem;
}
.wal__bybiz li + li {
  border-top: 1px solid var(--tvz-hairline);
}
.wal__bybizName {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wal__bybizVal {
  font-weight: 600;
  flex: none;
}
.wal__txnBiz {
  color: rgb(var(--v-theme-on-surface) / 0.5);
  font-size: 0.8rem;
}

.wal__stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
  margin: 1rem 0 1.5rem;
}
.wal__stats > div {
  padding: 0.9rem;
  border-radius: var(--tvz-radius-md);
  border: 1px solid var(--tvz-hairline);
  text-align: center;
}
.wal__stats span {
  display: block;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.wal__stats strong {
  font-size: 1.1rem;
}
.wal__statEq {
  display: block;
  margin-top: 0.1rem;
  font-size: 0.72rem;
  font-style: normal;
  text-transform: none;
  letter-spacing: 0;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}

.wal__buy,
.wal__history {
  margin-top: 1.75rem;
}
.wal__buy h2,
.wal__history h2 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.1rem;
  margin: 0 0 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.wal__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.wal__presets button {
  min-width: 54px;
  padding: 0.5rem 0.75rem;
  border-radius: 10px;
  border: 1px solid var(--tvz-glass-border);
  font-weight: 600;
  font-size: 0.9rem;
}
.wal__presets button.is-on {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary) / 0.12);
  color: rgb(var(--v-theme-primary));
}
.wal__custom {
  max-width: 150px;
}
.wal__preview {
  margin: 0.9rem 0;
  font-size: 0.95rem;
  font-weight: 500;
}
.wal__confirm {
  padding: 1.1rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
}
.wal__confirmHead {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.4rem;
  font-weight: 600;
}
.wal__confirmSum {
  margin: 0 0 0.3rem;
  font-size: 1.05rem;
}
.wal__devNote {
  margin: 0 0 0.8rem;
  font-size: 0.78rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.wal__confirmActions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.wal__error {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 1rem;
  padding: 0.7rem 1rem;
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-error) / 0.1);
  color: rgb(var(--v-theme-error));
  font-size: 0.82rem;
}
.wal__blocked {
  display: flex;
  gap: 0.6rem;
  padding: 0.9rem 1.1rem;
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-error) / 0.1);
  border: 1px solid rgb(var(--v-theme-error) / 0.35);
  color: rgb(var(--v-theme-error));
  font-size: 0.85rem;
}
.wal__blocked strong {
  display: block;
  margin-bottom: 0.15rem;
}
.wal__blocked p {
  margin: 0.1rem 0 0;
  color: rgb(var(--v-theme-on-surface) / 0.75);
}

.wal__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}
.wal__table th {
  text-align: left;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
  padding: 0.5rem 0.6rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.wal__table td {
  padding: 0.6rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.wal__table .is-in {
  color: rgb(var(--v-theme-success));
  font-weight: 600;
}
.wal__table .is-out {
  color: rgb(var(--v-theme-error));
  font-weight: 600;
}
.wal__badge {
  font-size: 0.72rem;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: rgb(var(--v-theme-on-surface) / 0.08);
}
.wal__badge--completed {
  background: rgb(var(--v-theme-success) / 0.16);
  color: rgb(var(--v-theme-success));
}
.wal__badge--pending {
  background: rgb(var(--v-theme-warning) / 0.16);
  color: rgb(var(--v-theme-warning));
}
.wal__muted {
  color: rgb(var(--v-theme-on-surface) / 0.55);
  font-size: 0.85rem;
}
</style>
