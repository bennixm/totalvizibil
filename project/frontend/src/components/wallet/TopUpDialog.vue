<script setup lang="ts">
/**
 * The buy-credits flow, as a popup instead of living inline on the Wallet
 * page — payment method on the left, amount + summary + confirm on the
 * right. Same store calls as before (startPurchase/confirmPending/
 * cancelPending); only where this UI lives changed. Only one method exists
 * today ("Card", our Stripe integration) — the two-pane layout is kept even
 * so, so a second method can slot in later without another restructure.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import { useWalletStore } from '@/stores/wallet'

const props = defineProps<{
  modelValue: boolean
  /** Fetched once by the page on load — passed down rather than re-fetched
   *  every time the dialog opens. */
  discountPct: number
}>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const { t, n } = useI18n()
const wallet = useWalletStore()
const { summary, pending, working, lastInvoice } = storeToRefs(wallet)

const billingBlocked = computed(() => !!summary.value && !summary.value.billingProfileComplete)
const unbilledCount = computed(() => summary.value?.unbilledPurchases ?? 0)

const open = computed({
  get: () => props.modelValue,
  set(v: boolean) {
    // Closing mid dev-stub-confirm (no real Stripe redirect in flight)
    // would otherwise leave that purchase dangling `pending` — same as
    // pressing its own Cancel button.
    if (!v && pending.value && !pending.value.checkoutUrl) wallet.cancelPending()
    emit('update:modelValue', v)
  },
})

const PRESETS = [10, 25, 50, 100]
const amount = ref(50)
const rate = computed(() => summary.value?.eurRonRate ?? 5.05)

function eur(v: number): string {
  return '€' + n(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function ron(eurValue: number): string {
  return n(eurValue * rate.value, { maximumFractionDigits: 0 }) + ' RON'
}
function discounted(v: number): number {
  return props.discountPct > 0 ? v * (1 - props.discountPct / 100) : v
}
function credits(v: number): string {
  return n(v, { maximumFractionDigits: 2 })
}

const previewValid = computed(() => Number.isInteger(amount.value) && amount.value >= 1)

async function buy(): Promise<void> {
  if (!previewValid.value) return
  await wallet.startPurchase(amount.value)
  // Stripe configured: the pending purchase carries a real Checkout Session
  // URL — leave the app entirely and let Stripe host the payment form. With
  // no Stripe key, `checkoutUrl` is null and the dev-stub confirm panel
  // below renders instead, unchanged.
  if (pending.value?.checkoutUrl) {
    window.location.href = pending.value.checkoutUrl
  }
}
async function confirm(): Promise<void> {
  await wallet.confirmPending()
}
</script>

<template>
  <v-dialog v-model="open" max-width="720" scrollable>
    <v-card class="topup">
      <button type="button" class="topup__close" :aria-label="t('common.cancel')" @click="open = false">
        <v-icon icon="mdi-close" size="18" />
      </button>

      <div class="topup__head">
        <h2>{{ t('wallet.topUpTitle') }}</h2>
        <p class="topup__headNote">{{ t('wallet.prepaidNote') }}</p>
      </div>

      <div v-if="!summary" class="topup__center">
        <v-progress-circular indeterminate color="primary" />
      </div>

      <template v-else>
        <div v-if="unbilledCount > 0 && !billingBlocked" class="topup__note topup__note--warn">
          <v-icon icon="mdi-receipt-text-remove-outline" size="18" />
          <div>
            <strong>{{ t('wallet.unbilledTitle') }}</strong>
            <p>{{ t('wallet.unbilledText', { n: unbilledCount }) }}</p>
            <v-btn class="mt-2" size="small" variant="tonal" :to="{ name: 'account', query: { tab: 'billing' } }">
              {{ t('wallet.unbilledCta') }}
            </v-btn>
          </div>
        </div>

        <div v-if="lastInvoice" class="topup__note topup__note--success">
          <v-icon icon="mdi-file-check-outline" size="16" />
          {{ t('wallet.invoiceIssued', { number: lastInvoice.number }) }}
          <a :href="`/account/invoices/${lastInvoice.id}`" target="_blank" rel="noopener">
            {{ t('wallet.invoiceView') }}
          </a>
        </div>

        <div v-if="billingBlocked" class="topup__note topup__note--error">
          <v-icon icon="mdi-file-document-alert-outline" size="18" />
          <div>
            <strong>{{ t('wallet.billingRequiredTitle') }}</strong>
            <p>{{ t('wallet.billingRequiredText') }}</p>
            <v-btn
              class="mt-2"
              color="primary"
              size="small"
              variant="tonal"
              append-icon="mdi-arrow-right"
              :to="{ name: 'account', query: { tab: 'billing' } }"
            >
              {{ t('wallet.billingRequiredCta') }}
            </v-btn>
          </div>
        </div>

        <div v-else-if="summary.blocked" class="topup__note topup__note--error">
          <v-icon icon="mdi-lock" size="18" />
          <div>
            <strong>{{ t('wallet.err.wallet_blocked') }}</strong>
            <p v-if="summary.blockedReason">{{ t('wallet.blockedReason', { reason: summary.blockedReason }) }}</p>
            <p>{{ t('wallet.blockedHelp') }}</p>
          </div>
        </div>

        <div v-else class="topup__body">
          <!-- Payment method — one option today ("Card" = Stripe). -->
          <div class="topup__methods">
            <p class="topup__paneLabel">{{ t('wallet.paymentMethod') }}</p>
            <div class="topup__method is-active">
              <v-icon icon="mdi-credit-card-outline" size="22" />
              <span>{{ t('wallet.cardMethod') }}</span>
            </div>
          </div>

          <div class="topup__amountPane">
            <template v-if="!pending">
              <p class="topup__paneLabel">{{ t('wallet.amountLabel') }}</p>
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

              <div class="topup__summary">
                <div class="topup__summaryRow">
                  <span>{{ t('wallet.youPay') }}</span>
                  <strong>
                    <template v-if="discountPct > 0">
                      <span class="wal__strike">{{ eur(amount || 0) }}</span>
                      {{ eur(discounted(amount || 0)) }}
                      <span class="wal__discountTag">-{{ discountPct }}%</span>
                    </template>
                    <template v-else>{{ eur(amount || 0) }}</template>
                  </strong>
                  <em class="topup__summaryEq">≈ {{ ron(discounted(amount || 0)) }}</em>
                </div>
                <div class="topup__summaryRow">
                  <span>{{ t('wallet.youGet') }}</span>
                  <strong>
                    {{ credits(amount || 0) }}
                    <v-icon icon="mdi-poker-chip" size="0.65em" class="topup__unit" />
                  </strong>
                </div>
              </div>

              <v-btn
                color="primary"
                block
                size="large"
                :disabled="!previewValid"
                :loading="working"
                append-icon="mdi-arrow-right"
                @click="buy"
              >
                {{ t('wallet.buyCta') }}
              </v-btn>
            </template>

            <!-- A real Stripe checkout URL was issued — `buy()` is already
                 navigating the browser away; never let the dev-stub panel
                 below render in the meantime (see WalletView's prior note on
                 why the redirect isn't synchronous). -->
            <div v-else-if="pending.checkoutUrl" class="wal__redirecting">
              <v-progress-circular indeterminate color="primary" size="28" />
              <p>{{ t('wallet.redirectingToStripe') }}</p>
            </div>

            <!-- Stub payment confirm — only reached with no Stripe key configured. -->
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
          </div>
        </div>
      </template>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.topup {
  position: relative;
  padding: 1.6rem;
}
.topup__close {
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.topup__close:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.topup__head {
  margin-bottom: 1.2rem;
}
.topup__head h2 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: 1.3rem;
  margin: 0;
}
.topup__headNote {
  margin: 0.3rem 0 0;
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.topup__center {
  display: grid;
  place-items: center;
  min-height: 160px;
}

.topup__note {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  padding: 0.85rem 1rem;
  border-radius: var(--tvz-radius-md);
  margin-bottom: 1rem;
  font-size: 0.84rem;
}
.topup__note strong {
  display: block;
  margin-bottom: 0.15rem;
}
.topup__note p {
  margin: 0.1rem 0 0;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.topup__note--warn {
  background: rgba(var(--v-theme-warning), 0.1);
  border: 1px solid rgba(var(--v-theme-warning), 0.35);
  color: rgb(var(--v-theme-warning));
}
.topup__note--error {
  background: rgba(var(--v-theme-error), 0.1);
  border: 1px solid rgba(var(--v-theme-error), 0.35);
  color: rgb(var(--v-theme-error));
}
.topup__note--success {
  background: rgba(var(--v-theme-success), 0.1);
  color: rgb(var(--v-theme-success));
}
.topup__note--success a {
  font-weight: 600;
  text-decoration: underline;
}

.topup__body {
  display: grid;
  grid-template-columns: 13rem 1fr;
  gap: 1.5rem;
}
.topup__paneLabel {
  margin: 0 0 0.6rem;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.topup__methods {
  border-right: 1px solid var(--tvz-hairline);
  padding-right: 1.5rem;
}
.topup__method {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 1.5rem 1rem;
  border-radius: var(--tvz-radius-md);
  border: 1px solid var(--tvz-glass-border);
  font-weight: 600;
  font-size: 0.92rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.topup__method.is-active {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}

.topup__summary {
  margin: 0.9rem 0 1.1rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-md);
  overflow: hidden;
}
.topup__summaryRow {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.7rem 0.9rem;
}
.topup__summaryRow + .topup__summaryRow {
  border-top: 1px solid var(--tvz-hairline);
}
.topup__summaryRow span {
  flex: 1;
  font-size: 0.84rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.topup__summaryRow strong {
  font-size: 1rem;
}
.topup__unit {
  margin-left: 0.2em;
  opacity: 0.75;
}
.topup__summaryEq {
  flex-basis: 100%;
  font-size: 0.76rem;
  font-style: normal;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

@media (max-width: 560px) {
  .topup__body {
    grid-template-columns: 1fr;
  }
  .topup__methods {
    border-right: 0;
    padding-right: 0;
    border-bottom: 1px solid var(--tvz-hairline);
    padding-bottom: 1.2rem;
  }
  .topup__method {
    flex-direction: row;
    justify-content: flex-start;
    padding: 0.9rem 1rem;
  }
}
</style>

<!-- Shared with the old inline layout's naming (presets/preview/redirect/confirm
     panel) so both this component and any leftover reference stay easy to compare. -->
<style scoped>
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
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.wal__custom {
  max-width: 150px;
}
.wal__strike {
  text-decoration: line-through;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-weight: 400;
  margin-right: 0.3rem;
}
.wal__discountTag {
  font-size: 0.68rem;
  font-weight: 800;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  background: rgba(var(--v-theme-success), 0.16);
  color: rgb(var(--v-theme-success));
  margin-left: 0.3rem;
}
.wal__redirecting {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.7rem;
  padding: 2rem 1rem;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-size: 0.88rem;
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
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.wal__confirmActions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
