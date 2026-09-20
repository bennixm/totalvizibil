<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminSection from '@/components/admin/AdminSection.vue'
import { useAdminStore } from '@/stores/admin'
import { useToastStore } from '@/stores/toast'
import type { AdminReferralsPage } from '@/stores/admin'
import { ApiError } from '@/services/api'

const { t } = useI18n()
const admin = useAdminStore()

const tab = ref<'pricing' | 'billing' | 'affiliate' | 'discount' | 'maintenance'>('pricing')
const loading = ref(true)
const saving = ref(false)
const toasts = useToastStore()
function flash(text: string, color: 'success' | 'error' = 'success') {
  toasts.push(color === 'error' ? 'error' : 'success', text)
}

const form = reactive({
  eurRonRate: 0,
  advancedBuilderPriceCredits: 0,
  advancedBuilderUnlockBonusCredits: 0,
  additionalBusinessPriceCredits: 0,
  invoiceVatRatePct: 0,
  refundFeePct: 0,
})
const affiliate = reactive({ enabled: false, rewardCredits: 20, minDeposit: 50 })
const REWARD_MIN = 1
const REWARD_MAX = 10000
const MIN_DEPOSIT_MIN = 0
const MIN_DEPOSIT_MAX = 100000
const referralStats = ref<AdminReferralsPage | null>(null)
const discount = reactive({ enabled: false, pct: 10 })
const DISCOUNT_MIN = 1
const DISCOUNT_MAX = 90
const discountValid = computed(
  () =>
    !discount.enabled ||
    (Number.isFinite(discount.pct) && discount.pct >= DISCOUNT_MIN && discount.pct <= DISCOUNT_MAX),
)

const maintenance = reactive({ title: '', message: '' })
const maintenanceSending = ref(false)
const maintenanceValid = computed(
  () => maintenance.title.trim().length > 0 && maintenance.message.trim().length > 0,
)
async function sendMaintenance() {
  if (!maintenanceValid.value) return
  maintenanceSending.value = true
  try {
    const res = await admin.broadcastMaintenance({
      title: maintenance.title.trim(),
      message: maintenance.message.trim(),
    })
    flash(t('adminSettings.maintenanceSent', { count: res.notified }))
    maintenance.title = ''
    maintenance.message = ''
  } catch (e) {
    flash(e instanceof ApiError ? e.message : t('admin.genericError'), 'error')
  } finally {
    maintenanceSending.value = false
  }
}
const issuer = reactive({
  invoiceIssuerName: '',
  invoiceIssuerTaxId: '',
  invoiceIssuerRegCom: '',
  invoiceIssuerAddress: '',
  invoiceIssuerIban: '',
  invoiceIssuerBank: '',
})
const issuerFields = [
  { key: 'invoiceIssuerName' as const, label: 'adminSettings.issuerName' },
  { key: 'invoiceIssuerTaxId' as const, label: 'adminSettings.issuerTaxId' },
  { key: 'invoiceIssuerRegCom' as const, label: 'adminSettings.issuerRegCom' },
  { key: 'invoiceIssuerAddress' as const, label: 'adminSettings.issuerAddress' },
  { key: 'invoiceIssuerIban' as const, label: 'adminSettings.issuerIban' },
  { key: 'invoiceIssuerBank' as const, label: 'adminSettings.issuerBank' },
]

const pricingFields = [
  {
    key: 'eurRonRate' as const,
    label: 'adminSettings.eurRonRate',
    hint: 'adminSettings.eurRonRateHint',
    icon: 'mdi-currency-eur',
    min: 1,
    max: 50,
    step: 0.01,
    suffix: 'RON',
  },
  {
    key: 'advancedBuilderPriceCredits' as const,
    label: 'adminSettings.advancedPrice',
    hint: 'adminSettings.advancedPriceHint',
    icon: 'mdi-hammer-wrench',
    min: 1,
    max: 100000,
    step: 1,
    suffix: 'cr',
  },
  {
    key: 'advancedBuilderUnlockBonusCredits' as const,
    label: 'adminSettings.unlockBonus',
    hint: 'adminSettings.unlockBonusHint',
    icon: 'mdi-gift-outline',
    min: 0,
    max: 100000,
    step: 1,
    suffix: 'cr',
  },
  {
    key: 'additionalBusinessPriceCredits' as const,
    label: 'adminSettings.extraBizPrice',
    hint: 'adminSettings.extraBizPriceHint',
    icon: 'mdi-domain-plus',
    min: 1,
    max: 100000,
    step: 1,
    suffix: 'cr',
  },
]
const billingFields = [
  {
    key: 'invoiceVatRatePct' as const,
    label: 'adminSettings.vatRate',
    hint: 'adminSettings.vatRateHint',
    icon: 'mdi-receipt-text-outline',
    min: 0,
    max: 30,
    step: 1,
    suffix: '%',
  },
]
const refundFields = [
  {
    key: 'refundFeePct' as const,
    label: 'adminSettings.refundFee',
    hint: 'adminSettings.refundFeeHint',
    icon: 'mdi-cash-refund',
    min: 0,
    max: 100,
    step: 1,
    suffix: '%',
  },
]
// Combined only for validation/dirty-tracking — the template renders each
// group in its own tab via the three arrays above.
const fields = [...pricingFields, ...billingFields, ...refundFields]

function hydrate() {
  if (!admin.settings) return
  form.eurRonRate = admin.settings.eurRonRate
  form.advancedBuilderPriceCredits = admin.settings.advancedBuilderPriceCredits
  form.advancedBuilderUnlockBonusCredits = admin.settings.advancedBuilderUnlockBonusCredits
  form.additionalBusinessPriceCredits = admin.settings.additionalBusinessPriceCredits
  form.invoiceVatRatePct = admin.settings.invoiceVatRatePct
  form.refundFeePct = admin.settings.refundFeePct
  affiliate.enabled = admin.settings.affiliateEnabled
  affiliate.rewardCredits = admin.settings.affiliateRewardCredits
  affiliate.minDeposit = admin.settings.affiliateMinDepositCredits
  discount.enabled = admin.settings.creditsDiscountEnabled
  discount.pct = admin.settings.creditsDiscountPct
  for (const f of issuerFields) issuer[f.key] = admin.settings[f.key]
}

const rewardValid = computed(
  () =>
    Number.isFinite(affiliate.rewardCredits) &&
    affiliate.rewardCredits >= REWARD_MIN &&
    affiliate.rewardCredits <= REWARD_MAX,
)
const minDepositValid = computed(
  () =>
    Number.isFinite(affiliate.minDeposit) &&
    affiliate.minDeposit >= MIN_DEPOSIT_MIN &&
    affiliate.minDeposit <= MIN_DEPOSIT_MAX,
)

const dirty = computed(
  () =>
    !!admin.settings &&
    (form.eurRonRate !== admin.settings.eurRonRate ||
      form.advancedBuilderPriceCredits !== admin.settings.advancedBuilderPriceCredits ||
      form.advancedBuilderUnlockBonusCredits !== admin.settings.advancedBuilderUnlockBonusCredits ||
      form.additionalBusinessPriceCredits !== admin.settings.additionalBusinessPriceCredits ||
      form.invoiceVatRatePct !== admin.settings.invoiceVatRatePct ||
      form.refundFeePct !== admin.settings.refundFeePct ||
      affiliate.enabled !== admin.settings.affiliateEnabled ||
      affiliate.rewardCredits !== admin.settings.affiliateRewardCredits ||
      affiliate.minDeposit !== admin.settings.affiliateMinDepositCredits ||
      discount.enabled !== admin.settings.creditsDiscountEnabled ||
      discount.pct !== admin.settings.creditsDiscountPct ||
      issuerFields.some((f) => issuer[f.key] !== admin.settings![f.key])),
)
const valid = computed(
  () =>
    rewardValid.value &&
    minDepositValid.value &&
    discountValid.value &&
    fields.every((f) => {
      const v = form[f.key]
      return typeof v === 'number' && Number.isFinite(v) && v >= f.min && v <= f.max
    }),
)

async function load() {
  loading.value = true
  try {
    await admin.fetchSettings()
    hydrate()
  } finally {
    loading.value = false
  }
  admin
    .fetchReferrals({ pageSize: 5 })
    .then((r) => (referralStats.value = r))
    .catch(() => {})
}
onMounted(load)

async function save() {
  if (!dirty.value || !valid.value) return
  saving.value = true
  try {
    await admin.updateSettings({
      ...form,
      ...issuer,
      affiliateEnabled: affiliate.enabled,
      affiliateRewardCredits: affiliate.rewardCredits,
      affiliateMinDepositCredits: affiliate.minDeposit,
      creditsDiscountEnabled: discount.enabled,
      creditsDiscountPct: discount.pct,
    })
    hydrate()
    flash(t('adminSettings.saved'))
  } catch (e) {
    flash(e instanceof ApiError ? e.message : t('admin.genericError'), 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="as">
    <AdminPageHeader
      :title="t('admin.navSettings')"
      :eyebrow="t('admin.navGroupConfig')"
      :sub="t('adminSettings.lead')"
    />

    <div v-if="loading" class="d-flex justify-center py-16">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else>
      <v-tabs v-model="tab" color="primary" class="as__tabs" show-arrows>
        <v-tab value="pricing" prepend-icon="mdi-cash-multiple">{{ t('adminSettings.tabPricing') }}</v-tab>
        <v-tab value="billing" prepend-icon="mdi-file-document-edit-outline">{{ t('adminSettings.tabBilling') }}</v-tab>
        <v-tab value="affiliate" prepend-icon="mdi-account-multiple-plus-outline">{{ t('adminSettings.tabAffiliate') }}</v-tab>
        <v-tab value="discount" prepend-icon="mdi-sale-outline">{{ t('adminSettings.tabDiscount') }}</v-tab>
        <v-tab value="maintenance" prepend-icon="mdi-wrench-cog-outline">{{ t('adminSettings.tabMaintenance') }}</v-tab>
      </v-tabs>

      <v-window v-model="tab" class="as__window">
        <!-- Prețuri & Monedă -->
        <v-window-item value="pricing">
          <AdminSection :title="t('adminSettings.pricingTitle')" icon="mdi-cash-multiple">
            <p class="as__sectionNote">{{ t('adminSettings.pricingNote') }}</p>
            <div class="as__fields">
              <div v-for="f in pricingFields" :key="f.key" class="as__field">
                <span class="as__ic"><v-icon :icon="f.icon" size="18" /></span>
                <div class="as__body">
                  <label :for="f.key" class="as__label">{{ t(f.label) }}</label>
                  <p class="as__hint">{{ t(f.hint) }}</p>
                </div>
                <v-text-field
                  :id="f.key"
                  v-model.number="form[f.key]"
                  type="number"
                  :min="f.min"
                  :max="f.max"
                  :step="f.step"
                  :suffix="f.suffix"
                  variant="outlined"
                  density="compact"
                  hide-details
                  class="as__input"
                />
              </div>
            </div>
          </AdminSection>
        </v-window-item>

        <!-- Facturare & Rambursări -->
        <v-window-item value="billing">
          <AdminSection :title="t('adminSettings.issuerTitle')" icon="mdi-file-document-edit-outline">
            <p class="as__sectionNote">{{ t('adminSettings.billingNote') }}</p>

            <div class="as__fields">
              <div v-for="f in billingFields" :key="f.key" class="as__field">
                <span class="as__ic"><v-icon :icon="f.icon" size="18" /></span>
                <div class="as__body">
                  <label :for="f.key" class="as__label">{{ t(f.label) }}</label>
                  <p class="as__hint">{{ t(f.hint) }}</p>
                </div>
                <v-text-field
                  :id="f.key"
                  v-model.number="form[f.key]"
                  type="number"
                  :min="f.min"
                  :max="f.max"
                  :step="f.step"
                  :suffix="f.suffix"
                  variant="outlined"
                  density="compact"
                  hide-details
                  class="as__input"
                />
              </div>
            </div>

            <p class="as__sectionNote as__sectionNote--tight">{{ t('adminSettings.issuerNote') }}</p>
            <div class="as__issuerGrid">
              <v-text-field
                v-for="f in issuerFields"
                :key="f.key"
                v-model="issuer[f.key]"
                :label="t(f.label)"
                variant="outlined"
                density="compact"
                hide-details
              />
            </div>
          </AdminSection>

          <AdminSection :title="t('adminSettings.refundTitle')" icon="mdi-cash-refund" class="mt-4">
            <div class="as__fields">
              <div v-for="f in refundFields" :key="f.key" class="as__field">
                <span class="as__ic"><v-icon :icon="f.icon" size="18" /></span>
                <div class="as__body">
                  <label :for="f.key" class="as__label">{{ t(f.label) }}</label>
                  <p class="as__hint">{{ t(f.hint) }}</p>
                </div>
                <v-text-field
                  :id="f.key"
                  v-model.number="form[f.key]"
                  type="number"
                  :min="f.min"
                  :max="f.max"
                  :step="f.step"
                  :suffix="f.suffix"
                  variant="outlined"
                  density="compact"
                  hide-details
                  class="as__input"
                />
              </div>
            </div>
          </AdminSection>
        </v-window-item>

        <!-- Program de afiliere -->
        <v-window-item value="affiliate">
          <AdminSection :title="t('adminSettings.affiliateTitle')" icon="mdi-account-multiple-plus-outline">
            <p class="as__sectionNote">{{ t('adminSettings.affiliateNote') }}</p>

            <div class="as__field">
              <span class="as__ic"><v-icon icon="mdi-power" size="18" /></span>
              <div class="as__body">
                <label class="as__label">{{ t('adminSettings.affiliateEnabled') }}</label>
                <p class="as__hint">{{ t('adminSettings.affiliateEnabledHint') }}</p>
              </div>
              <v-switch
                v-model="affiliate.enabled"
                color="primary"
                density="compact"
                hide-details
                inset
              />
            </div>

            <div class="as__field">
              <span class="as__ic"><v-icon icon="mdi-gift-outline" size="18" /></span>
              <div class="as__body">
                <label for="affReward" class="as__label">{{ t('adminSettings.affiliateReward') }}</label>
                <p class="as__hint">{{ t('adminSettings.affiliateRewardHint') }}</p>
              </div>
              <v-text-field
                id="affReward"
                v-model.number="affiliate.rewardCredits"
                type="number"
                :min="REWARD_MIN"
                :max="REWARD_MAX"
                step="1"
                suffix="cr"
                variant="outlined"
                density="compact"
                hide-details
                class="as__input"
                :error="!rewardValid"
              />
            </div>

            <div class="as__field">
              <span class="as__ic"><v-icon icon="mdi-cash-multiple" size="18" /></span>
              <div class="as__body">
                <label for="affMinDep" class="as__label">{{ t('adminSettings.affiliateMinDeposit') }}</label>
                <p class="as__hint">{{ t('adminSettings.affiliateMinDepositHint') }}</p>
              </div>
              <v-text-field
                id="affMinDep"
                v-model.number="affiliate.minDeposit"
                type="number"
                :min="MIN_DEPOSIT_MIN"
                :max="MIN_DEPOSIT_MAX"
                step="1"
                suffix="cr"
                variant="outlined"
                density="compact"
                hide-details
                class="as__input"
                :error="!minDepositValid"
              />
            </div>

            <div v-if="referralStats" class="as__affStats">
              <div class="as__affStat">
                <span class="as__affNum">{{ referralStats.total }}</span>
                <span class="as__affLbl">{{ t('adminSettings.affiliateTotalReferrals') }}</span>
              </div>
              <div class="as__affStat">
                <span class="as__affNum">{{ referralStats.totalRewarded }}</span>
                <span class="as__affLbl">{{ t('adminSettings.affiliateRewarded') }}</span>
              </div>
              <div class="as__affStat">
                <span class="as__affNum">{{ referralStats.creditsPaid }}</span>
                <span class="as__affLbl">{{ t('adminSettings.affiliateCreditsPaid') }}</span>
              </div>
            </div>
          </AdminSection>
        </v-window-item>

        <!-- Reduceri -->
        <v-window-item value="discount">
          <AdminSection :title="t('adminSettings.discountTitle')" icon="mdi-sale-outline">
            <p class="as__sectionNote">{{ t('adminSettings.discountNote') }}</p>

            <div class="as__field">
              <span class="as__ic"><v-icon icon="mdi-power" size="18" /></span>
              <div class="as__body">
                <label class="as__label">{{ t('adminSettings.discountEnabled') }}</label>
                <p class="as__hint">{{ t('adminSettings.discountEnabledHint') }}</p>
              </div>
              <v-switch v-model="discount.enabled" color="primary" density="compact" hide-details inset />
            </div>

            <div class="as__field">
              <span class="as__ic"><v-icon icon="mdi-percent-outline" size="18" /></span>
              <div class="as__body">
                <label for="discountPct" class="as__label">{{ t('adminSettings.discountPct') }}</label>
                <p class="as__hint">{{ t('adminSettings.discountPctHint') }}</p>
              </div>
              <v-text-field
                id="discountPct"
                v-model.number="discount.pct"
                type="number"
                :min="DISCOUNT_MIN"
                :max="DISCOUNT_MAX"
                step="1"
                suffix="%"
                variant="outlined"
                density="compact"
                hide-details
                class="as__input"
                :error="!discountValid"
              />
            </div>
          </AdminSection>
        </v-window-item>

        <!-- Mentenanță -->
        <v-window-item value="maintenance">
          <AdminSection :title="t('adminSettings.maintenanceTitle')" icon="mdi-wrench-cog-outline">
            <p class="as__sectionNote">{{ t('adminSettings.maintenanceNote') }}</p>

            <v-text-field
              v-model="maintenance.title"
              :label="t('adminSettings.maintenanceTitleField')"
              variant="outlined"
              density="compact"
              class="mb-3"
              hide-details
            />
            <v-textarea
              v-model="maintenance.message"
              :label="t('adminSettings.maintenanceMessage')"
              variant="outlined"
              density="compact"
              rows="3"
              hide-details
            />
            <div class="as__foot as__foot--inline">
              <v-btn
                color="primary"
                variant="flat"
                :disabled="!maintenanceValid"
                :loading="maintenanceSending"
                prepend-icon="mdi-send-outline"
                @click="sendMaintenance"
              >
                {{ t('adminSettings.maintenanceSend') }}
              </v-btn>
            </div>
          </AdminSection>
        </v-window-item>
      </v-window>

      <div class="as__savebar" :class="{ 'as__savebar--dirty': dirty }">
        <span v-if="dirty" class="as__dirty">
          <v-icon icon="mdi-circle-medium" size="18" />
          {{ t('adminSettings.unsaved') }}
        </span>
        <span v-else class="as__saved">{{ t('adminSettings.allSaved') }}</span>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!dirty || !valid"
          :loading="saving"
          prepend-icon="mdi-content-save-outline"
          @click="save"
        >
          {{ t('common.save') }}
        </v-btn>
      </div>
    </template>
  </div>
</template>

<style scoped>
.as__tabs {
  border-bottom: 1px solid var(--tvz-hairline);
  margin-bottom: 1.4rem;
}
.as__window {
  margin-bottom: 1.2rem;
}
.as__fields {
  display: flex;
  flex-direction: column;
}
.as__field {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 1rem 0.4rem;
  margin-inline: -0.4rem;
  border-bottom: 1px solid var(--tvz-hairline);
  border-radius: 8px;
  transition: background var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease);
}
.as__field:hover {
  background: rgba(var(--v-theme-on-surface), 0.025);
}
.as__field:first-child {
  padding-top: 0.4rem;
}
.as__field:last-child {
  border-bottom: none;
}
.as__ic {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  flex: none;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.as__body {
  flex: 1;
  min-width: 0;
}
.as__label {
  font-weight: 600;
  font-size: 0.9rem;
}
.as__hint {
  margin: 0.15rem 0 0;
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.as__input {
  flex: none;
  width: 150px;
}
.as__foot--inline {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 1rem;
  margin-top: 1.2rem;
}
.as__savebar {
  position: sticky;
  bottom: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 1rem;
  padding: 0.8rem 1.1rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  box-shadow: var(--tvz-shadow-md);
}
.as__savebar--dirty {
  border-color: rgba(var(--v-theme-warning), 0.4);
}
.as__dirty {
  display: inline-flex;
  align-items: center;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgb(var(--v-theme-warning));
  margin-right: auto;
}
.as__dirty .v-icon {
  color: rgb(var(--v-theme-warning));
}
.as__saved {
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
  margin-right: auto;
}
.as__sectionNote {
  margin: 0 0 1rem;
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.as__sectionNote--tight {
  margin-top: 1.4rem;
  padding-top: 1.2rem;
  border-top: 1px solid var(--tvz-hairline);
}
.as__issuerGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.9rem;
}
.as__affStats {
  display: flex;
  gap: 1.5rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--tvz-hairline);
}
.as__affStat {
  display: flex;
  flex-direction: column;
}
.as__affNum {
  font-size: 1.3rem;
  font-weight: 700;
}
.as__affLbl {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
</style>
