<script setup lang="ts">
import { uiLocale } from '@/plugins/i18n'
/**
 * The buy-credits flow, as a popup instead of living inline on the Wallet
 * page — payment method on the left, amount + summary + confirm on the
 * right. Same store calls as before (startPurchase/confirmPending/
 * cancelPending); only where this UI lives changed. Only one method exists
 * today ("Card", our Stripe integration) — the two-pane layout is kept even
 * so, so a second method can slot in later without another restructure.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import { useWalletStore, type SavedCard } from '@/stores/wallet'
import { useToastStore } from '@/stores/toast'

const props = defineProps<{
  modelValue: boolean
  /** Fetched once by the page on load — passed down rather than re-fetched
   *  every time the dialog opens. */
  discountPct: number
}>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const { t, n } = useI18n()
const wallet = useWalletStore()
const { summary, pending, working, lastInvoice, paymentMethods, paymentMethodsEnabled } =
  storeToRefs(wallet)
const toasts = useToastStore()

// Payment method: a saved card (charged at once, no card form) or a new card
// through Stripe Checkout (optionally saved for next time).
const NEW_CARD = 'new'
const selectedMethod = ref<string>(NEW_CARD)
const saveCard = ref(false)
const selectedCard = computed<SavedCard | null>(
  () => paymentMethods.value.find((c) => c.id === selectedMethod.value) ?? null,
)
watch(
  () => props.modelValue,
  async (isOpen) => {
    if (!isOpen) return
    await wallet.loadPaymentMethods()
    // Preselect the most recent saved card, so a returning customer only
    // picks an amount and pays.
    selectedMethod.value = paymentMethods.value[0]?.id ?? NEW_CARD
    saveCard.value = false
  },
  { immediate: true },
)
const BRANDS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  maestro: 'Maestro',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
}
function brandName(b: string): string {
  return BRANDS[b] ?? b.charAt(0).toUpperCase() + b.slice(1)
}
function expiry(c: SavedCard): string {
  return `${String(c.expMonth).padStart(2, '0')}/${String(c.expYear).slice(-2)}`
}

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
  const card = selectedCard.value
  const res = await wallet.startPurchase(
    amount.value,
    card ? { paymentMethodId: card.id } : { saveCard: saveCard.value },
  )
  if (!res) return // the error is already shown (declined card, etc.)
  if (res.status === 'completed') {
    // Saved card charged and credited on the spot: nothing else to do.
    toasts.success(t('wallet.paidWithSavedCard', { credits: res.credits }))
    emit('update:modelValue', false)
    return
  }
  // Stripe Checkout (new card) or the bank's 3-D Secure page (saved card):
  // leave the app; Stripe brings the customer back to /wallet to verify.
  // With no Stripe key, there is no URL and the dev-stub panel renders.
  const url = res.redirectUrl ?? res.checkoutUrl
  if (url) window.location.href = url
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
          <!-- Payment method: the cards saved on Stripe, or a new card. -->
          <div class="topup__methods" role="radiogroup" :aria-label="t('wallet.paymentMethod')">
            <p class="topup__paneLabel">{{ t('wallet.paymentMethod') }}</p>
            <button
              v-for="c in paymentMethods"
              :key="c.id"
              type="button"
              role="radio"
              class="topup__method topup__method--card"
              :class="{ 'is-active': selectedMethod === c.id }"
              :aria-checked="selectedMethod === c.id"
              :disabled="!!pending || working"
              @click="selectedMethod = c.id"
            >
              <v-icon icon="mdi-credit-card-check-outline" size="22" />
              <span class="topup__cardName">{{ brandName(c.brand) }} •••• {{ c.last4 }}</span>
              <span class="topup__cardExp">{{ t('wallet.cardExpires', { date: expiry(c) }) }}</span>
            </button>
            <button
              type="button"
              role="radio"
              class="topup__method"
              :class="{ 'is-active': selectedMethod === NEW_CARD }"
              :aria-checked="selectedMethod === NEW_CARD"
              :disabled="!!pending || working"
              @click="selectedMethod = NEW_CARD"
            >
              <v-icon icon="mdi-credit-card-plus-outline" size="22" />
              <span>{{ paymentMethods.length ? t('wallet.newCard') : t('wallet.cardMethod') }}</span>
            </button>
            <v-checkbox
              v-if="paymentMethodsEnabled && selectedMethod === NEW_CARD"
              v-model="saveCard"
              :label="t('wallet.saveCard')"
              color="primary"
              density="compact"
              hide-details
              class="topup__save"
            />
            <p v-if="paymentMethodsEnabled" class="topup__secure">
              <v-icon icon="mdi-lock-outline" size="13" /> {{ t('wallet.cardsSecureNote') }}
            </p>
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
                :append-icon="selectedCard ? 'mdi-lock-outline' : 'mdi-arrow-right'"
                @click="buy"
              >
                {{
                  selectedCard
                    ? t('wallet.payWithCard', { last4: selectedCard.last4 })
                    : t('wallet.buyCta')
                }}
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
                  ron: (pending.ronBani / 100).toLocaleString(uiLocale()) + ' RON',
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
  border-radius: 0;
  clip-path: var(--tvz-hex-sm);
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
  font-size: var(--tvz-fs-dialog-title);
  margin: 0;
}
.topup__headNote {
  margin: 0.3rem 0 0;
  font-size: var(--tvz-fs-small);
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
  font-size: var(--tvz-fs-small);
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
  font-size: var(--tvz-fs-caption);
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
  font-size: var(--tvz-fs-section);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.topup__method.is-active {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}
/* Several options now (saved cards + new card): a stack of tiles. */
.topup__method {
  width: 100%;
  margin-bottom: 0.5rem;
  color: inherit;
  cursor: pointer;
  background: transparent;
  text-align: center;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.topup__method:not(.is-active):hover {
  border-color: rgba(var(--v-theme-primary), 0.45);
}
.topup__method:disabled {
  cursor: default;
  opacity: 0.6;
}
.topup__method--card {
  padding: 0.9rem 0.8rem;
  gap: 0.2rem;
}
.topup__cardName {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.topup__cardExp {
  font-size: var(--tvz-fs-caption);
  font-weight: 400;
  opacity: 0.7;
}
.topup__save {
  margin-top: 0.15rem;
}
.topup__save :deep(.v-label) {
  font-size: var(--tvz-fs-small);
  line-height: 1.3;
  opacity: 0.9;
}
.topup__secure {
  display: flex;
  gap: 0.3rem;
  align-items: flex-start;
  margin: 0.5rem 0 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
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
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.topup__summaryRow strong {
  font-size: var(--tvz-fs-lead);
}
.topup__unit {
  margin-left: 0.2em;
  opacity: 0.75;
}
.topup__summaryEq {
  flex-basis: 100%;
  font-size: var(--tvz-fs-caption);
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
  font-size: var(--tvz-fs-section);
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
  font-size: var(--tvz-fs-micro);
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
  font-size: var(--tvz-fs-body);
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
  font-size: var(--tvz-fs-lead);
}
.wal__devNote {
  margin: 0 0 0.8rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.wal__confirmActions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
