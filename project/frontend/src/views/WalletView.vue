<script setup lang="ts">
import { uiLocale } from '@/plugins/i18n'
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
import { useWalletStore, type PaymentKind } from '@/stores/wallet'
import { useToastStore } from '@/stores/toast'
import { fetchPricing } from '@/services/platform'
import { useAdvancedUnlockStore } from '@/stores/advanced-unlock'
import {
  clearUnlockReturn,
  readStoredUnlockReturn,
  unlockReturnFromQuery,
  unlockRouteFor,
  walletQueryFor,
  type UnlockReturn,
} from '@/lib/unlockReturn'
import {
  adsReturnFromQuery,
  adsRouteFor,
  clearAdsReturn,
  readStoredAdsReturn,
  type AdsReturn,
} from '@/lib/adsReturn'

const { t, n } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const wallet = useWalletStore()
const money = useMoney()
const { summary, loading, working, error } = storeToRefs(wallet)
const { overview } = storeToRefs(companies)
const { payments, paymentsNextCursor } = storeToRefs(wallet)

const showTopUp = ref(false)

// --- "Add credits, then back to unlock" detour (advanced onboarding) ---
// Carried by `?from=unlock&c=…`; after a Stripe round-trip (URL has only
// `checkout`/`txn`) restored from the short-lived session copy.
const unlockStore = useAdvancedUnlockStore()
const unlockReturn = ref<UnlockReturn | null>(
  unlockReturnFromQuery(route.query) ?? (route.query.checkout ? readStoredUnlockReturn() : null),
)
const unlockPrice = computed<number | null>(() =>
  unlockReturn.value && unlockStore.view ? unlockStore.view.priceCredits : null,
)
const unlockShort = computed(() =>
  unlockPrice.value == null
    ? 0
    : Math.max(0, unlockPrice.value - (summary.value?.balance.credits ?? 0)),
)
const unlockReady = computed(
  () => unlockPrice.value != null && (unlockShort.value === 0 || !!unlockStore.view?.unlocked),
)
/** Query to keep after consuming one-shot params, so the banner and the
 *  guide stay on while the detour is active. */
function keptQuery() {
  if (adsReturn.value) {
    const r = adsReturn.value
    return { from: 'ads', ads: r.id, ...(r.tab ? { tab: r.tab } : {}) }
  }
  return unlockReturn.value ? walletQueryFor(unlockReturn.value) : {}
}
function backToUnlock(): void {
  const r = unlockReturn.value
  if (!r) return
  clearUnlockReturn()
  void router.push(unlockRouteFor(r))
}

// --- "Add credits, then back to the Google Ads campaign" detour ---
const adsReturn = ref<AdsReturn | null>(
  adsReturnFromQuery(route.query) ?? (route.query.checkout ? readStoredAdsReturn() : null),
)
function backToAds(): void {
  const r = adsReturn.value
  if (!r) return
  clearAdsReturn()
  void router.push(adsRouteFor(r))
}

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

// --- Payments/Refunds statement (below Refund) ------------------------
const paymentsKind = ref<PaymentKind>('purchase')
const paymentsFrom = ref('')
const paymentsTo = ref('')
const paymentsLoading = ref(true)
const paymentsLoadingMore = ref(false)
const hasDateFilters = computed(() => !!paymentsFrom.value || !!paymentsTo.value)

async function loadPaymentsInitial(): Promise<void> {
  paymentsLoading.value = true
  try {
    await wallet.loadPayments(false, {
      kind: paymentsKind.value,
      from: paymentsFrom.value || null,
      to: paymentsTo.value || null,
    })
  } catch {
    toasts.error(t('wallet.historyError'))
  } finally {
    paymentsLoading.value = false
  }
}

async function loadPaymentsMore(): Promise<void> {
  if (paymentsLoadingMore.value || !paymentsNextCursor.value) return
  paymentsLoadingMore.value = true
  try {
    await wallet.loadPayments(true)
  } catch {
    toasts.error(t('wallet.historyError'))
  } finally {
    paymentsLoadingMore.value = false
  }
}

function clearPaymentsDates(): void {
  paymentsFrom.value = ''
  paymentsTo.value = ''
}

// An inverted range (from > to) would silently come back empty with no clue
// why — correct it to a valid range first, which re-triggers this watcher via
// its own dependency and only THEN fetches, rather than ever fetching an
// impossible range.
watch([paymentsKind, paymentsFrom, paymentsTo], ([, from, to], prev) => {
  if (from && to && from > to) {
    const prevFrom = prev?.[1]
    if (from !== prevFrom) paymentsTo.value = from
    else paymentsFrom.value = to
    return
  }
  void loadPaymentsInitial()
})

onMounted(async () => {
  await Promise.all([
    wallet.load(),
    companies.fetchOverview().catch(() => {}),
    loadPaymentsInitial(),
    unlockReturn.value ? unlockStore.load(unlockReturn.value.c) : Promise.resolve(),
  ])
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
    void router.replace({ query: keptQuery() })
  } else if (checkout === 'cancel') {
    toasts.error(t('wallet.checkoutCanceled'))
    void router.replace({ query: keptQuery() })
  }
})

// Arrived via the navbar's "+" shortcut — open the top-up dialog straight
// away instead of making them find the button on the page. A `watch`
// (not just the `onMounted` check above) so clicking "+" while already on
// this page also opens it — a query-only navigation to the same route
// doesn't remount the component, so `onMounted` alone would miss it.
watch(
  () => route.query.topup,
  (v) => {
    if (v !== '1') return
    showTopUp.value = true
    void router.replace({ query: keptQuery() })
  },
  { immediate: true },
)
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
      <!-- Google Ads detour: add credits, then back to the campaign. -->
      <section v-if="adsReturn && !unlockReturn" class="wal__unlock is-ready">
        <v-icon icon="mdi-google-ads" size="22" class="wal__unlockIcon" />
        <div class="wal__unlockBody">
          <p class="wal__unlockTitle">{{ t('wallet.adsReturn.title') }}</p>
          <p class="wal__unlockText">{{ t('wallet.adsReturn.text') }}</p>
        </div>
        <div class="wal__unlockActions">
          <v-btn size="small" variant="text" prepend-icon="mdi-plus" @click="showTopUp = true">
            {{ t('wallet.topUpCta') }}
          </v-btn>
          <v-btn size="small" color="primary" variant="flat" append-icon="mdi-arrow-right" @click="backToAds">
            {{ t('wallet.adsReturn.back') }}
          </v-btn>
        </div>
      </section>

      <!-- Advanced onboarding detour: add credits, then back to unlock. -->
      <section
        v-if="unlockReturn"
        class="wal__unlock"
        :class="{ 'is-ready': unlockReady }"
        data-guide="wallet-unlock-banner"
      >
        <v-icon
          :icon="unlockReady ? 'mdi-lock-open-check-outline' : 'mdi-lock-open-variant-outline'"
          size="22"
          class="wal__unlockIcon"
        />
        <div class="wal__unlockBody">
          <p class="wal__unlockTitle">{{ t('wallet.unlockReturn.title') }}</p>
          <p class="wal__unlockText">
            <template v-if="unlockPrice == null">{{ t('wallet.unlockReturn.textNoPrice') }}</template>
            <template v-else-if="unlockReady">
              {{ t('wallet.unlockReturn.ready', { price: credits(unlockPrice) }) }}
            </template>
            <template v-else>
              {{ t('wallet.unlockReturn.short', { short: credits(unlockShort), price: credits(unlockPrice) }) }}
            </template>
          </p>
        </div>
        <div class="wal__unlockActions">
          <v-btn
            v-if="!unlockReady"
            size="small"
            color="primary"
            prepend-icon="mdi-plus"
            @click="showTopUp = true"
          >
            {{ t('wallet.topUpCta') }}
          </v-btn>
          <v-btn
            size="small"
            :variant="unlockReady ? 'flat' : 'text'"
            :color="unlockReady ? 'primary' : undefined"
            append-icon="mdi-arrow-right"
            data-guide="wallet-unlock-return"
            :class="{ 'is-ready': unlockReady }"
            @click="backToUnlock"
          >
            {{ t('wallet.unlockReturn.back') }}
          </v-btn>
        </div>
      </section>

      <!-- Balance + at-a-glance figures + top-up trigger, one 3-column panel. -->
      <section class="wal__card">
        <div class="wal__side">
          <v-icon icon="mdi-piggy-bank-outline" size="20" class="wal__sideIcon" />
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
            {{ credits(summary.balance.credits) }}
            <v-icon icon="mdi-poker-chip" size="0.55em" class="wal__balanceUnit" />
          </p>
          <p class="wal__balanceEq">{{ money.approx(summary.balance.credits) }}</p>

          <v-btn
            color="primary"
            size="large"
            class="wal__topUpBtn"
            data-guide="wallet-topup"
            prepend-icon="mdi-plus"
            @click="showTopUp = true"
          >
            {{ t('wallet.topUpCta') }}
          </v-btn>
        </div>

        <div class="wal__side">
          <v-icon icon="mdi-poker-chip" size="20" class="wal__sideIcon" />
          <span class="wal__sideLabel">{{ t('wallet.obtained') }}</span>
          <strong class="wal__sideValue">{{ credits(summary.obtained.credits) }}</strong>
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

      <!-- Payments/Refunds statement -->
      <AdminSection class="wal__section" :title="t('wallet.paymentsTitle')" icon="mdi-receipt-text-outline">
        <template #actions>
          <v-btn
            variant="tonal"
            size="small"
            prepend-icon="mdi-download"
            :href="wallet.paymentsExportUrl()"
          >
            {{ t('wallet.paymentsDownloadPdf') }}
          </v-btn>
        </template>

        <div class="wal__payToolbar">
          <div class="wal__payTabs" role="tablist">
            <button
              type="button"
              role="tab"
              :aria-selected="paymentsKind === 'purchase'"
              :class="{ 'is-on': paymentsKind === 'purchase' }"
              @click="paymentsKind = 'purchase'"
            >
              {{ t('wallet.paymentsTabPayments') }}
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="paymentsKind === 'refund'"
              :class="{ 'is-on': paymentsKind === 'refund' }"
              @click="paymentsKind = 'refund'"
            >
              {{ t('wallet.paymentsTabRefunds') }}
            </button>
          </div>
          <div class="wal__payDates">
            <label class="wal__payDateField">
              <span>{{ t('wallet.paymentsFromLabel') }}</span>
              <input type="date" v-model="paymentsFrom" />
            </label>
            <label class="wal__payDateField">
              <span>{{ t('wallet.paymentsToLabel') }}</span>
              <input type="date" v-model="paymentsTo" />
            </label>
            <button v-if="hasDateFilters" type="button" class="wal__payDateClear" @click="clearPaymentsDates">
              <v-icon icon="mdi-close" size="14" /> {{ t('wallet.paymentsClearDates') }}
            </button>
          </div>
        </div>

        <div v-if="paymentsLoading && !payments.length" class="wal__center">
          <v-progress-circular indeterminate color="primary" />
        </div>
        <p v-else-if="!payments.length" class="wal__payEmpty">{{ t('wallet.paymentsEmpty') }}</p>
        <template v-else>
          <div class="wal__payTableWrap">
            <table class="wal__payTable">
              <thead>
                <tr>
                  <th>{{ t('wallet.colId') }}</th>
                  <th class="num">{{ t('wallet.colAmount') }}</th>
                  <th class="end">{{ t('wallet.colDate') }}</th>
                  <th class="end">{{ t('wallet.colStatus') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in payments" :key="p.id" class="payrow">
                  <td class="payrow__id" :data-label="t('wallet.colId')">#{{ p.id.slice(0, 8) }}</td>
                  <td class="num" :data-label="t('wallet.colAmount')">
                    <span class="payrow__amount" :class="p.amount.minor < 0 ? 'is-out' : 'is-in'">
                      <CreditsValue :credits="p.amount.credits" signed stacked />
                    </span>
                  </td>
                  <td class="end payrow__date" :data-label="t('wallet.colDate')">
                    {{ new Date(p.createdAt).toLocaleDateString(uiLocale()) }}
                  </td>
                  <td class="end" :data-label="t('wallet.colStatus')">
                    <span class="payrow__badge" :class="'payrow__badge--' + p.status">
                      {{ t('wallet.txnStatus.' + p.status) }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <button
            v-if="paymentsNextCursor"
            type="button"
            class="wal__payMore"
            :disabled="paymentsLoadingMore"
            @click="loadPaymentsMore"
          >
            <v-icon icon="mdi-reload" size="15" /> {{ t('wallet.loadMore') }}
          </button>
        </template>
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
            :error="!refundAmountValid"
          >
            <template #append-inner>
              <v-icon icon="mdi-poker-chip" size="16" />
            </template>
          </v-text-field>
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
  max-width: 1020px;
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
  background: var(--tvz-gradient-wallet);
}
.wal__side {
  padding: 1.5rem 1rem;
  text-align: center;
}
.wal__sideIcon {
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-bottom: 0.4rem;
}
.wal__sideLabel {
  display: block;
  font-size: var(--tvz-fs-micro);
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
  font-size: var(--tvz-fs-small);
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
  color:var(--tvz-accept-green-darker);
}
.wal__balanceUnit {
  margin-left: 0.15em;
  opacity: 0.7;
  vertical-align: 0.08em;
}
.wal__balanceEq {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.wal__unlock {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
  margin-bottom: 1rem;
  padding: 0.9rem 1.1rem;
  border-radius: var(--tvz-radius-lg);
  border: 1px solid rgba(var(--v-theme-primary), 0.3);
  background: rgba(var(--v-theme-primary), 0.07);
}
.wal__unlock.is-ready {
  border-color: rgba(var(--v-theme-success), 0.45);
  background: rgba(var(--v-theme-success), 0.09);
}
.wal__unlockIcon {
  flex: none;
  color: rgb(var(--v-theme-primary));
}
.wal__unlock.is-ready .wal__unlockIcon {
  color: rgb(var(--v-theme-success));
}
.wal__unlockBody {
  flex: 1 1 16rem;
  min-width: 0;
}
.wal__unlockTitle {
  margin: 0;
  font-weight: 700;
  font-size: 0.95rem;
}
.wal__unlockText {
  margin: 0.15rem 0 0;
  font-size: 0.86rem;
  line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.72);
}
.wal__unlockActions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
@media (max-width: 600px) {
  .wal__unlockActions {
    width: 100%;
  }
  .wal__unlockActions .v-btn {
    flex: 1 1 auto;
  }
}

.wal__topUpBtn {
  margin-top: 1.1rem;
  background-color: var(--tvz-accept-green) !important;
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
  font-size: var(--tvz-fs-section);
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
  font-size: var(--tvz-fs-small);
}
.wal__refundLine {
  margin: 0 0 0.9rem;
  font-size: var(--tvz-fs-body);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.wal__refundNote {
  margin: 0.7rem 0 0;
  font-size: var(--tvz-fs-body);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.wal__refundHoldNote {
  margin: 0.6rem 0 0;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.55);
}

/* Payments/Refunds statement */
.wal__payToolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-bottom: 1rem;
}
.wal__payTabs {
  display: inline-flex;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 0;
  clip-path: var(--tvz-hex-md);
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}
.wal__payTabs button {
  padding: 0.4rem 0.9rem;
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  transition:
    background var(--tvz-dur-fast) var(--tvz-ease-out),
    color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.wal__payTabs button + button {
  border-left: 1px solid var(--tvz-glass-border);
}
.wal__payTabs button.is-on {
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}
.wal__payDates {
  display: flex;
  align-items: end;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.wal__payDateField {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.wal__payDateField input[type='date'] {
  padding: 0.4rem 0.55rem;
  border: 1px solid var(--tvz-hairline, rgba(var(--v-theme-on-surface), 0.15));
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  font-size: var(--tvz-fs-small);
}
.wal__payDateClear {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.4rem 0.6rem;
  border-radius: 8px;
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.wal__payDateClear:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.wal__payEmpty {
  padding: 2rem 1rem;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.wal__payTableWrap {
  overflow-x: auto;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
}
.wal__payTable {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--tvz-fs-body);
}
.wal__payTable thead th {
  text-align: left;
  font-size: var(--tvz-fs-micro);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.5);
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--tvz-glass-border);
  white-space: nowrap;
}
.wal__payTable th.num,
.wal__payTable td.num,
.wal__payTable th.end,
.wal__payTable td.end {
  text-align: right;
}
.wal__payTable td {
  padding: 0.65rem 1rem;
  vertical-align: middle;
}
.payrow + .payrow td {
  border-top: 1px solid var(--tvz-hairline);
}
.payrow:hover {
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.payrow__id {
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), 0.5);
  white-space: nowrap;
}
.payrow__amount.is-in {
  color: rgb(var(--v-theme-success));
  font-weight: 600;
}
.payrow__amount.is-out {
  color: rgb(var(--v-theme-error));
  font-weight: 600;
}
.payrow__date {
  white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.payrow__badge {
  font-size: var(--tvz-fs-micro);
  padding: 0.1rem 0.5rem;
  border-radius: 0;
  clip-path: var(--tvz-hex-xs);
  background: rgba(var(--v-theme-on-surface), 0.08);
  white-space: nowrap;
}
.payrow__badge--completed {
  background: rgba(var(--v-theme-success), 0.16);
  color: rgb(var(--v-theme-success));
}
.payrow__badge--pending {
  background: rgba(var(--v-theme-warning), 0.16);
  color: rgb(var(--v-theme-warning));
}
.payrow__badge--failed {
  background: rgba(var(--v-theme-error), 0.16);
  color: rgb(var(--v-theme-error));
}
.wal__payMore {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  width: 100%;
  margin-top: 0.75rem;
  padding: 0.6rem;
  border-radius: var(--tvz-radius-md);
  border: 1px solid var(--tvz-glass-border);
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.wal__payMore:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
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
}

/* Mobile: date filters stack full-width instead of fighting the tabs for
   room, and the payments table stops scrolling sideways — each row becomes
   its own card instead. */
@media (max-width: 640px) {
  .wal__payToolbar {
    flex-direction: column;
    align-items: stretch;
  }
  /* Stacked, not side-by-side: a native `<input type="date">` has a wide
     intrinsic min-content width (calendar icon + day/month/year segments)
     that flex items don't shrink below by default (`min-width: auto`), so
     fitting "De la" + "Până la" on the same row — even at `flex: 1 1 auto`
     — squeezed/clipped the inputs and pushed the row past the viewport
     width on a phone. One field per line has no such floor to hit. */
  .wal__payDates {
    flex-direction: column;
    align-items: stretch;
  }
  .wal__payDateField {
    width: 100%;
  }
  .wal__payDateField input[type='date'] {
    width: 100%;
  }
  .wal__payDateClear {
    align-self: flex-start;
  }

  .wal__payTable {
    white-space: normal;
  }
  .wal__payTable thead {
    display: none;
  }
  .wal__payTable,
  .wal__payTable tbody,
  .wal__payTable tr {
    display: block;
    width: 100%;
  }
  .payrow {
    display: flex;
    flex-direction: column;
    row-gap: 0.4rem;
    padding: 0.8rem 0.9rem;
  }
  .payrow + .payrow td {
    border-top: none;
  }
  .payrow:not(:last-child) {
    border-bottom: 1px solid var(--tvz-hairline);
  }
  /* Every field gets its own clearly labeled row instead of floating,
     unlabeled, on a shared wrapped line (the old layout read as a jumble). */
  .wal__payTable td {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    column-gap: 0.75rem;
    width: 100%;
    padding: 0;
    text-align: left;
  }
  .wal__payTable td::before {
    content: attr(data-label);
    flex-shrink: 0;
    font-size: var(--tvz-fs-micro);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(var(--v-theme-on-surface), 0.45);
  }
  .wal__payTable td.num {
    order: 1;
  }
  .wal__payTable td.payrow__id {
    order: 2;
  }
  .wal__payTable td.end:not(.payrow__date) {
    order: 3;
  }
  .wal__payTable td.payrow__date.end {
    order: 4;
  }
}
</style>
