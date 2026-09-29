<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminSection from '@/components/admin/AdminSection.vue'
import CreditsValue from '@/components/CreditsValue.vue'
import InfoHint from '@/components/InfoHint.vue'
import TopUpDialog from '@/components/wallet/TopUpDialog.vue'
import { useMoney } from '@/composables/useMoney'
import { useCompaniesStore } from '@/stores/companies'
import { useWalletStore } from '@/stores/wallet'
import { useToastStore } from '@/stores/toast'
import { fetchPricing } from '@/services/platform'

const { t, n } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const wallet = useWalletStore()
const money = useMoney()
const { summary, loading, working, error } = storeToRefs(wallet)
const { overview } = storeToRefs(companies)

const showTopUp = ref(false)

const CURRENCIES = ['EUR', 'RON'] as const

const KNOWN_ERRORS = [
  'wallet_blocked',
  'insufficient_credits',
  'billing_profile_incomplete',
  'insufficient_balance_for_refund',
  'insufficient_refundable_purchases',
]
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

const toasts = useToastStore()
watch(error, (v) => {
  if (v) toasts.error(errorText.value)
})

const consumers = computed(() => overview.value.filter((c) => c.consumedCredits > 0))

/** Fetched once here (page load) and handed down to the top-up dialog,
 *  rather than re-fetched every time it opens. */
const discountPct = ref(0)

function eur(v: number): string {
  return '€' + n(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function credits(v: number): string {
  return n(v, { maximumFractionDigits: 2 })
}

// --- Refund the wallet balance ---------------------------------------
// Every user can ask for the unspent part of their balance back — not tied
// to any one purchase (the balance is a fungible pool; WalletService
// allocates the request across whichever purchases still have refundable
// capacity). `refundable` is the practical ceiling: it can be less than the
// raw balance if part of it isn't backed by a real Stripe charge.
const showRefundConfirm = ref(false)
const refundAmount = ref(0)
const refundableCredits = computed(() => summary.value?.refundable.credits ?? 0)
const refundFeePct = computed(() => summary.value?.refundFeePct ?? 0)
const refundFeeCredits = computed(() => (refundAmount.value * refundFeePct.value) / 100)
const refundAmountValid = computed(
  () =>
    Number.isFinite(refundAmount.value) &&
    refundAmount.value > 0 &&
    refundAmount.value <= refundableCredits.value,
)

function openRefundConfirm(): void {
  refundAmount.value = refundableCredits.value
  showRefundConfirm.value = true
}

async function confirmRefund(): Promise<void> {
  if (!refundAmountValid.value) return
  // A failure sets `wallet.error` — the watcher above already turns that
  // into a toast via `errorText`, so only the success case needs one here.
  const ok = await wallet.requestRefund(refundAmount.value)
  showRefundConfirm.value = false
  if (ok) toasts.success(t('wallet.refundRequested'))
}

onMounted(async () => {
  await Promise.all([wallet.load(), companies.fetchOverview().catch(() => {})])
  try {
    const pricing = await fetchPricing()
    if (pricing.creditsDiscountEnabled) discountPct.value = pricing.creditsDiscountPct
  } catch {
    /* no discount banner if this fails — purchase still works at full price */
  }

  // Back from a Stripe Checkout redirect — the whole SPA reloaded, so this
  // reads entirely from the URL rather than any in-memory `pending` state.
  const checkout = route.query.checkout
  const txn = typeof route.query.txn === 'string' ? route.query.txn : null
  if (checkout === 'success' && txn) {
    const ok = await wallet.confirmTransaction(txn)
    toasts[ok ? 'success' : 'error'](ok ? t('wallet.checkoutSuccess') : errorText.value)
    void router.replace({ query: {} })
  } else if (checkout === 'cancel') {
    toasts.error(t('wallet.checkoutCanceled'))
    void router.replace({ query: {} })
  }
})
</script>

<template>
  <v-container class="wal">
    <AdminPageHeader :eyebrow="t('wallet.eyebrow')" :title="t('wallet.title')">
      <template #actions>
        <v-btn
          variant="tonal"
          size="small"
          append-icon="mdi-arrow-right"
          :to="{ name: 'wallet-transactions' }"
        >
          {{ t('wallet.viewTransactionsCta') }}
        </v-btn>
      </template>
    </AdminPageHeader>

    <div v-if="loading" class="wal__center"><v-progress-circular indeterminate color="primary" /></div>

    <template v-else-if="summary">
      <!-- Balance + at-a-glance figures + top-up trigger, one 3-column panel. -->
      <section class="wal__card">
        <div class="wal__side">
          <span class="wal__sideLabel">{{ t('wallet.deposited') }}</span>
          <strong class="wal__sideValue">{{ eur(summary.depositedEurCents / 100) }}</strong>
        </div>

        <div class="wal__balance">
          <p class="wal__balanceLabel">
            {{ t('wallet.balance') }}
            <InfoHint
              :text="`${t('wallet.mainNote')} ${t('wallet.rateNote', { rate: n(summary.eurRonRate, { maximumFractionDigits: 4 }) })}`"
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

          <v-btn
            color="primary"
            size="large"
            class="wal__topUpBtn"
            prepend-icon="mdi-plus"
            @click="showTopUp = true"
          >
            {{ t('wallet.topUpCta') }}
          </v-btn>
        </div>

        <div class="wal__side wal__side--stack">
          <div>
            <span class="wal__sideLabel">{{ t('wallet.purchased') }}</span>
            <strong class="wal__sideValue">{{ credits(summary.purchased.credits) }}</strong>
          </div>
          <div>
            <span class="wal__sideLabel">{{ t('wallet.spent') }}</span>
            <strong class="wal__sideValue">{{ credits(summary.spent.credits) }}</strong>
          </div>
        </div>
      </section>

      <TopUpDialog v-model="showTopUp" :discount-pct="discountPct" />

      <!-- Refund the wallet balance -->
      <AdminSection
        v-if="refundableCredits > 0"
        class="wal__section"
        :title="t('wallet.refundTitle')"
        icon="mdi-cash-refund"
      >
        <template #actions>
          <InfoHint :text="t('wallet.refundHint')" />
        </template>
        <p class="wal__refundLine">
          {{ t('wallet.refundAvailable', { credits: credits(refundableCredits) }) }}
        </p>
        <v-btn variant="tonal" prepend-icon="mdi-cash-refund" @click="openRefundConfirm">
          {{ t('wallet.refundCta') }}
        </v-btn>
      </AdminSection>

      <!-- Consumption per business -->
      <AdminSection
        v-if="consumers.length"
        class="wal__section"
        :title="t('wallet.byBusinessTitle')"
        icon="mdi-domain"
      >
        <ul class="wal__bybiz">
          <li v-for="c in consumers" :key="c.id">
            <span class="wal__bybizName">{{ c.displayName }}</span>
            <span class="wal__bybizVal"><CreditsValue :credits="c.consumedCredits" /></span>
          </li>
        </ul>
      </AdminSection>
    </template>

    <v-dialog v-model="showRefundConfirm" max-width="440">
      <v-card>
        <v-card-title class="text-h6">{{ t('wallet.refundConfirmTitle') }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model.number="refundAmount"
            type="number"
            :min="0.01"
            :max="refundableCredits"
            step="0.01"
            variant="outlined"
            density="compact"
            :label="t('wallet.refundAmountLabel')"
            :suffix="t('wallet.credits')"
            :error="!refundAmountValid"
          />
          <p class="wal__refundNote">
            {{ t('wallet.refundAvailable', { credits: credits(refundableCredits) }) }}
          </p>
          <p v-if="refundFeePct > 0" class="wal__refundNote">
            {{ t('wallet.refundConfirmFee', { pct: refundFeePct, fee: credits(refundFeeCredits) }) }}
          </p>
          <p class="wal__refundHoldNote">{{ t('wallet.refundConfirmHold') }}</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="working" @click="showRefundConfirm = false">
            {{ t('common.cancel') }}
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :disabled="!refundAmountValid"
            :loading="working"
            @click="confirmRefund"
          >
            {{ t('wallet.refundCta') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.wal {
  max-width: 820px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.wal__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}

/* Balance + at-a-glance figures + top-up trigger — one 3-column panel,
   center column carrying the primary action. */
.wal__card {
  display: grid;
  grid-template-columns: 1fr 1.4fr 1fr;
  align-items: center;
  border-radius: var(--tvz-radius-lg);
  border: 1px solid var(--tvz-glass-border);
  background: var(--tvz-ai-soft);
}
.wal__side {
  padding: 1.5rem 1rem;
  text-align: center;
}
.wal__side--stack {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}
.wal__sideLabel {
  display: block;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.wal__sideValue {
  display: block;
  margin-top: 0.25rem;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.2rem;
}
.wal__balance {
  padding: 1.6rem 1.5rem;
  text-align: center;
  border-left: 1px solid var(--tvz-glass-border);
  border-right: 1px solid var(--tvz-glass-border);
}
.wal__balanceLabel {
  margin: 0;
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
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
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.wal__balanceEq {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.7);
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
  color: rgba(var(--v-theme-on-surface), 0.5);
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
  color: rgba(var(--v-theme-on-surface), 0.6);
  transition:
    background var(--tvz-dur-fast) var(--tvz-ease-out),
    color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.wal__currencyBtns button + button {
  border-left: 1px solid var(--tvz-glass-border);
}
.wal__currencyBtns button.is-on {
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}
.wal__currencyBtns button:disabled {
  opacity: 0.5;
}
.wal__topUpBtn {
  margin-top: 1.1rem;
}

.wal__bybiz {
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

.wal__section {
  margin-top: 1.25rem;
}

.wal__error {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 1rem;
  padding: 0.7rem 1rem;
  border-radius: var(--tvz-radius-md);
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
  font-size: 0.82rem;
}
.wal__refundLine {
  margin: 0 0 0.9rem;
  font-size: 0.88rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.wal__refundNote {
  margin: 0.7rem 0 0;
  font-size: 0.85rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.wal__refundHoldNote {
  margin: 0.6rem 0 0;
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

@media (max-width: 620px) {
  .wal__card {
    grid-template-columns: 1fr;
  }
  .wal__balance {
    border-left: 0;
    border-right: 0;
    border-top: 1px solid var(--tvz-glass-border);
    border-bottom: 1px solid var(--tvz-glass-border);
    order: -1;
  }
  .wal__side--stack {
    flex-direction: row;
    justify-content: space-around;
  }
}
</style>
