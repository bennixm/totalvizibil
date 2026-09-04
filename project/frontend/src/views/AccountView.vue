<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import QRCode from 'qrcode'

import { useAuthStore } from '@/stores/auth'
import { useAccountStore } from '@/stores/account'
import { useBillingStore, type BillingKind } from '@/stores/billing'
import { ApiError } from '@/services/api'

const { t } = useI18n()
const route = useRoute()
const auth = useAuthStore()
const account = useAccountStore()
const billing = useBillingStore()

const TABS = ['profile', 'security', 'sessions', 'billing'] as const
const tab = ref<(typeof TABS)[number]>(
  TABS.includes(route.query.tab as (typeof TABS)[number]) ? (route.query.tab as (typeof TABS)[number]) : 'profile',
)
const loading = ref(true)
const toast = reactive({ show: false, text: '', color: 'success' })
function flash(text: string, color: 'success' | 'error' = 'success') {
  toast.text = text
  toast.color = color
  toast.show = true
}
function errText(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

onMounted(async () => {
  try {
    await Promise.all([account.loadSecurity(), account.loadSessions(), billing.load()])
  } finally {
    loading.value = false
  }
})

// --- Profile ---------------------------------------------------------------
const profile = reactive({ name: '', email: '', currentPassword: '' })
watch(
  () => account.security,
  (s) => {
    if (s) {
      profile.name = s.name
      profile.email = s.email
    }
  },
  { immediate: true },
)
const emailChanged = computed(() => account.security && profile.email !== account.security.email)
const profileBusy = ref(false)

async function saveProfile() {
  profileBusy.value = true
  try {
    await account.updateProfile({
      name: profile.name.trim(),
      email: emailChanged.value ? profile.email.trim() : undefined,
      currentPassword: emailChanged.value ? profile.currentPassword : undefined,
    })
    profile.currentPassword = ''
    flash(t('account.profileSaved'))
  } catch (e) {
    flash(errText(e, t('account.genericError')), 'error')
  } finally {
    profileBusy.value = false
  }
}

// --- Change password ----------------------------------------------------
const pw = reactive({ current: '', next: '', confirm: '' })
const pwMismatch = computed(() => pw.confirm.length > 0 && pw.next !== pw.confirm)
const pwBusy = ref(false)
async function savePassword() {
  if (pw.next.length < 8 || pwMismatch.value) return
  pwBusy.value = true
  try {
    await account.changePassword({ currentPassword: pw.current, newPassword: pw.next })
    pw.current = pw.next = pw.confirm = ''
    flash(t('account.passwordChanged'))
  } catch (e) {
    flash(errText(e, t('account.genericError')), 'error')
  } finally {
    pwBusy.value = false
  }
}

// --- Two-factor -------------------------------------------------------
const twoFa = computed(() => account.security?.twoFactor)
const totpQr = ref('')
const totpCode = ref('')
const totpBusy = ref(false)
const disarmCode = ref('')

watch(
  () => account.totpSetup?.otpauthUrl,
  async (url) => {
    totpQr.value = url ? await QRCode.toDataURL(url, { margin: 1, width: 200 }) : ''
  },
)

async function beginTotp() {
  totpBusy.value = true
  try {
    await account.startTotpSetup()
  } catch (e) {
    flash(errText(e, t('account.genericError')), 'error')
  } finally {
    totpBusy.value = false
  }
}
async function confirmTotp() {
  totpBusy.value = true
  try {
    await account.enableTotp(totpCode.value.trim())
    totpCode.value = ''
    flash(t('account.totpEnabled'))
  } catch (e) {
    flash(errText(e, t('account.totpBadCode')), 'error')
  } finally {
    totpBusy.value = false
  }
}
async function turnOffTotp() {
  totpBusy.value = true
  try {
    await account.disableTotp(disarmCode.value.trim())
    disarmCode.value = ''
    flash(t('account.totpDisabled'))
  } catch (e) {
    flash(errText(e, t('account.totpBadCode')), 'error')
  } finally {
    totpBusy.value = false
  }
}

// --- Sessions --------------------------------------------------------
function deviceIcon(ua: string | null): string {
  const s = (ua ?? '').toLowerCase()
  if (/mobile|android|iphone/.test(s)) return 'mdi-cellphone'
  if (/curl|postman|python|node/.test(s)) return 'mdi-console'
  return 'mdi-monitor'
}
function deviceLabel(ua: string | null): string {
  if (!ua) return t('account.unknownDevice')
  const m = ua.match(/(Firefox|Edg|Chrome|Safari|curl)[/ ]?([\d.]+)?/i)
  return m ? m[0].replace('Edg', 'Edge') : ua.slice(0, 40)
}
const otherSessions = computed(() => account.sessions.filter((s) => !s.current).length)
const sessionsBusy = ref(false)
async function signOutOthers() {
  sessionsBusy.value = true
  try {
    const revoked = await account.revokeOtherSessions()
    flash(t('account.sessionsRevoked', { n: revoked }))
  } catch (e) {
    flash(errText(e, t('account.genericError')), 'error')
  } finally {
    sessionsBusy.value = false
  }
}

// --- Billing (Persoană fizică / Persoană juridică + invoices) ----------
const bf = reactive({
  kind: 'individual' as BillingKind,
  name: '',
  taxId: '',
  regCom: '',
  vatPayer: false,
  address: '',
  city: '',
  county: '',
  postalCode: '',
  country: 'RO',
  billingEmail: '',
  iban: '',
  bankName: '',
})
watch(
  () => billing.profile,
  (p) => {
    if (!p) return
    bf.kind = p.kind
    bf.name = p.name
    bf.taxId = p.taxId ?? ''
    bf.regCom = p.regCom ?? ''
    bf.vatPayer = p.vatPayer
    bf.address = p.address
    bf.city = p.city
    bf.county = p.county ?? ''
    bf.postalCode = p.postalCode ?? ''
    bf.country = p.country
    bf.billingEmail = p.billingEmail ?? ''
    bf.iban = p.iban ?? ''
    bf.bankName = p.bankName ?? ''
  },
  { immediate: true },
)
const billingValid = computed(
  () =>
    bf.name.trim().length > 1 &&
    bf.address.trim().length > 2 &&
    bf.city.trim().length > 1 &&
    (bf.kind === 'individual' || (bf.taxId.trim().length > 1 && bf.regCom.trim().length > 1)),
)
async function saveBilling() {
  if (!billingValid.value) return
  const ok = await billing.saveProfile({
    kind: bf.kind,
    name: bf.name.trim(),
    taxId: bf.kind === 'company' ? bf.taxId.trim() : undefined,
    regCom: bf.kind === 'company' ? bf.regCom.trim() : undefined,
    vatPayer: bf.vatPayer,
    address: bf.address.trim(),
    city: bf.city.trim(),
    county: bf.county.trim() || undefined,
    postalCode: bf.postalCode.trim() || undefined,
    country: bf.country.trim() || 'RO',
    billingEmail: bf.billingEmail.trim() || undefined,
    iban: bf.iban.trim() || undefined,
    bankName: bf.bankName.trim() || undefined,
  })
  if (ok) {
    flash(
      billing.lastBackfillCount
        ? t('account.billingSavedBackfilled', { n: billing.lastBackfillCount })
        : t('account.billingSaved'),
    )
  } else {
    flash(errText(new Error(billing.error), t('account.genericError')), 'error')
  }
}
</script>

<template>
  <v-container class="acc py-8">
    <div class="page-container">
      <header class="acc__head">
        <div class="acc__avatar">{{ (auth.user?.name ?? '?').slice(0, 1).toUpperCase() }}</div>
        <div>
          <h1>{{ t('account.title') }}</h1>
          <p>{{ auth.user?.email }}</p>
        </div>
      </header>

      <v-tabs v-model="tab" color="primary" class="acc__tabs" show-arrows>
        <v-tab value="profile" prepend-icon="mdi-account-outline">{{ t('account.tabProfile') }}</v-tab>
        <v-tab value="security" prepend-icon="mdi-shield-lock-outline">{{ t('account.tabSecurity') }}</v-tab>
        <v-tab value="sessions" prepend-icon="mdi-devices">{{ t('account.tabSessions') }}</v-tab>
        <v-tab value="billing" prepend-icon="mdi-file-document-outline">
          {{ t('account.tabBilling') }}
          <v-icon v-if="!billing.isComplete" icon="mdi-alert-circle" size="14" color="warning" class="ms-1" />
        </v-tab>
      </v-tabs>

      <div v-if="loading" class="d-flex justify-center py-16">
        <v-progress-circular indeterminate color="primary" />
      </div>

      <v-window v-else v-model="tab" class="acc__window" :class="{ 'acc__window--wide': tab === 'billing' }">
        <!-- PROFILE -->
        <v-window-item value="profile">
          <v-card border flat class="tvz-card pa-5">
            <h2 class="acc__h2">{{ t('account.profileTitle') }}</h2>
            <v-form @submit.prevent="saveProfile">
              <v-text-field v-model="profile.name" :label="t('auth.name')" prepend-inner-icon="mdi-account-outline" />
              <v-text-field
                v-model="profile.email"
                :label="t('auth.email')"
                type="email"
                prepend-inner-icon="mdi-email-outline"
              />
              <v-expand-transition>
                <v-text-field
                  v-if="emailChanged"
                  v-model="profile.currentPassword"
                  :label="t('account.currentPassword')"
                  :hint="t('account.emailChangeHint')"
                  persistent-hint
                  type="password"
                  prepend-inner-icon="mdi-lock-outline"
                />
              </v-expand-transition>
              <v-btn
                type="submit"
                color="primary"
                variant="flat"
                rounded="pill"
                class="mt-3"
                :loading="profileBusy"
              >
                {{ t('common.save') }}
              </v-btn>
            </v-form>
          </v-card>
        </v-window-item>

        <!-- SECURITY -->
        <v-window-item value="security">
          <div class="d-flex flex-column ga-4">
            <v-card border flat class="tvz-card pa-5">
              <h2 class="acc__h2">{{ t('account.changePasswordTitle') }}</h2>
              <p class="acc__note">{{ t('account.changePasswordNote') }}</p>
              <v-form @submit.prevent="savePassword">
                <v-text-field
                  v-model="pw.current"
                  :label="t('account.currentPassword')"
                  type="password"
                  autocomplete="current-password"
                  prepend-inner-icon="mdi-lock-outline"
                />
                <v-text-field
                  v-model="pw.next"
                  :label="t('account.newPassword')"
                  :hint="t('auth.passwordHint')"
                  type="password"
                  autocomplete="new-password"
                  prepend-inner-icon="mdi-lock-plus-outline"
                />
                <v-text-field
                  v-model="pw.confirm"
                  :label="t('reset.confirmPassword')"
                  type="password"
                  autocomplete="new-password"
                  prepend-inner-icon="mdi-lock-check-outline"
                  :error="pwMismatch"
                  :error-messages="pwMismatch ? t('reset.mismatch') : ''"
                />
                <v-btn
                  type="submit"
                  color="primary"
                  variant="flat"
                  rounded="pill"
                  class="mt-2"
                  :loading="pwBusy"
                  :disabled="pw.next.length < 8 || pwMismatch"
                >
                  {{ t('account.updatePassword') }}
                </v-btn>
              </v-form>
            </v-card>

            <v-card border flat class="tvz-card pa-5">
              <div class="d-flex align-center justify-space-between flex-wrap ga-2 mb-1">
                <h2 class="acc__h2 mb-0">{{ t('account.twoFaTitle') }}</h2>
                <v-chip
                  size="small"
                  :color="twoFa?.enabled ? 'success' : undefined"
                  :variant="twoFa?.enabled ? 'tonal' : 'outlined'"
                  :prepend-icon="twoFa?.enabled ? 'mdi-shield-check' : 'mdi-shield-off-outline'"
                >
                  {{ twoFa?.enabled ? t('account.twoFaOn') : t('account.twoFaOff') }}
                </v-chip>
              </div>
              <p class="acc__note">{{ t('account.twoFaNote') }}</p>

              <!-- enabled -> disable -->
              <template v-if="twoFa?.enabled">
                <v-text-field
                  v-model="disarmCode"
                  :label="t('auth.totpCode')"
                  inputmode="numeric"
                  maxlength="6"
                  prepend-inner-icon="mdi-shield-key-outline"
                  style="max-width: 220px"
                />
                <v-btn
                  color="error"
                  variant="tonal"
                  rounded="pill"
                  :loading="totpBusy"
                  :disabled="disarmCode.length !== 6"
                  @click="turnOffTotp"
                >
                  {{ t('account.twoFaDisable') }}
                </v-btn>
              </template>

              <!-- setup in progress -->
              <template v-else-if="account.totpSetup">
                <div class="totp-setup">
                  <img v-if="totpQr" :src="totpQr" alt="" class="totp-setup__qr" />
                  <div class="totp-setup__body">
                    <p class="acc__note mb-1">{{ t('account.twoFaScan') }}</p>
                    <code class="totp-setup__secret">{{ account.totpSetup.secret }}</code>
                    <v-text-field
                      v-model="totpCode"
                      :label="t('account.twoFaEnterCode')"
                      inputmode="numeric"
                      maxlength="6"
                      class="mt-3"
                      prepend-inner-icon="mdi-shield-key-outline"
                    />
                    <v-btn
                      color="primary"
                      variant="flat"
                      rounded="pill"
                      :loading="totpBusy"
                      :disabled="totpCode.length !== 6"
                      @click="confirmTotp"
                    >
                      {{ t('account.twoFaConfirm') }}
                    </v-btn>
                  </div>
                </div>
              </template>

              <!-- disabled -> start -->
              <template v-else>
                <v-btn
                  color="primary"
                  variant="tonal"
                  rounded="pill"
                  prepend-icon="mdi-shield-plus-outline"
                  :loading="totpBusy"
                  @click="beginTotp"
                >
                  {{ t('account.twoFaEnable') }}
                </v-btn>
              </template>
            </v-card>
          </div>
        </v-window-item>

        <!-- SESSIONS -->
        <v-window-item value="sessions">
          <v-card border flat class="tvz-card pa-5">
            <div class="d-flex align-center justify-space-between flex-wrap ga-2 mb-3">
              <h2 class="acc__h2 mb-0">{{ t('account.sessionsTitle') }}</h2>
              <v-btn
                variant="tonal"
                rounded="pill"
                size="small"
                prepend-icon="mdi-logout-variant"
                :disabled="otherSessions === 0"
                :loading="sessionsBusy"
                @click="signOutOthers"
              >
                {{ t('account.signOutOthers') }}
              </v-btn>
            </div>
            <v-list class="acc__sessions" lines="two">
              <v-list-item v-for="s in account.sessions" :key="s.id" :prepend-icon="deviceIcon(s.userAgent)">
                <v-list-item-title>
                  {{ deviceLabel(s.userAgent) }}
                  <v-chip v-if="s.current" size="x-small" color="primary" variant="tonal" class="ms-2">
                    {{ t('account.thisDevice') }}
                  </v-chip>
                </v-list-item-title>
                <v-list-item-subtitle>
                  {{ s.ip || '—' }} · {{ new Date(s.createdAt).toLocaleString() }}
                </v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-card>
        </v-window-item>

        <!-- BILLING -->
        <v-window-item value="billing">
          <div class="d-flex flex-column ga-4">
            <v-alert v-if="!billing.isComplete" type="warning" variant="tonal" density="compact" icon="mdi-file-document-alert-outline">
              {{ t('account.billingIncompleteAlert') }}
            </v-alert>

            <v-card border flat class="tvz-card pa-5">
              <div class="d-flex align-center justify-space-between flex-wrap ga-2 mb-1">
                <h2 class="acc__h2 mb-0">{{ t('account.billingTitle') }}</h2>
                <router-link :to="{ name: 'invoices' }" class="acc__invoicesLink">
                  <v-icon icon="mdi-receipt-text-outline" size="15" />
                  {{ t('account.billingSeeInvoices') }}
                </router-link>
              </div>
              <p class="acc__note">{{ t('account.billingNote') }}</p>

              <v-btn-toggle v-model="bf.kind" mandatory color="primary" density="comfortable" class="mb-4">
                <v-btn value="individual" prepend-icon="mdi-account-outline">
                  {{ t('account.billingKindIndividual') }}
                </v-btn>
                <v-btn value="company" prepend-icon="mdi-domain">
                  {{ t('account.billingKindCompany') }}
                </v-btn>
              </v-btn-toggle>

              <v-form @submit.prevent="saveBilling">
                <v-text-field
                  v-model="bf.name"
                  :label="bf.kind === 'company' ? t('account.billingLegalName') : t('account.billingFullName')"
                  prepend-inner-icon="mdi-badge-account-outline"
                />
                <template v-if="bf.kind === 'company'">
                  <div class="acc__row2">
                    <v-text-field v-model="bf.taxId" :label="t('account.billingTaxId')" prepend-inner-icon="mdi-identifier" />
                    <v-text-field v-model="bf.regCom" :label="t('account.billingRegCom')" prepend-inner-icon="mdi-office-building-outline" />
                  </div>
                  <v-checkbox v-model="bf.vatPayer" :label="t('account.billingVatPayer')" density="compact" hide-details class="mb-2" />
                </template>

                <v-text-field v-model="bf.address" :label="t('account.billingAddress')" prepend-inner-icon="mdi-map-marker-outline" />
                <div class="acc__row2">
                  <v-text-field v-model="bf.city" :label="t('account.billingCity')" />
                  <v-text-field v-model="bf.county" :label="t('account.billingCounty')" />
                </div>
                <div class="acc__row2">
                  <v-text-field v-model="bf.postalCode" :label="t('account.billingPostalCode')" />
                  <v-text-field v-model="bf.country" :label="t('account.billingCountry')" />
                </div>
                <v-text-field
                  v-model="bf.billingEmail"
                  :label="t('account.billingEmail')"
                  type="email"
                  prepend-inner-icon="mdi-email-outline"
                />
                <template v-if="bf.kind === 'company'">
                  <div class="acc__row2">
                    <v-text-field v-model="bf.iban" :label="t('account.billingIban')" prepend-inner-icon="mdi-bank-outline" />
                    <v-text-field v-model="bf.bankName" :label="t('account.billingBankName')" />
                  </div>
                </template>

                <v-btn
                  type="submit"
                  color="primary"
                  variant="flat"
                  rounded="pill"
                  class="mt-1"
                  :loading="billing.working"
                  :disabled="!billingValid"
                >
                  {{ t('common.save') }}
                </v-btn>
              </v-form>
            </v-card>
          </div>
        </v-window-item>
      </v-window>
    </div>

    <v-snackbar v-model="toast.show" :color="toast.color" timeout="2600" location="bottom">
      {{ toast.text }}
    </v-snackbar>
  </v-container>
</template>

<style scoped>
.acc__head {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.acc__avatar {
  width: 52px;
  height: 52px;
  border-radius: 16px;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 1.3rem;
  color: #fff;
  background: var(--tvz-gradient-brand);
}
.acc__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.5rem, 4vw, 2rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.acc__head p {
  margin: 0;
  color: rgb(var(--v-theme-on-surface) / 0.6);
  font-size: 0.9rem;
}
.acc__tabs {
  border-bottom: 1px solid var(--tvz-hairline);
  margin-bottom: 1.5rem;
}
.acc__window {
  max-width: 640px;
}
.acc__window--wide {
  max-width: 760px;
}
.acc__row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 1rem;
}
.acc__invoicesLink {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
}
.acc__h2 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.05rem;
  font-weight: 600;
  margin: 0 0 0.3rem;
}
.acc__note {
  font-size: 0.83rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
  margin: 0 0 1rem;
}
.totp-setup {
  display: flex;
  gap: 1.4rem;
  flex-wrap: wrap;
  align-items: flex-start;
}
.totp-setup__qr {
  width: 168px;
  height: 168px;
  border-radius: var(--tvz-radius-sm);
  border: 1px solid var(--tvz-hairline);
  background: #fff;
}
.totp-setup__body {
  flex: 1;
  min-width: 220px;
}
.totp-setup__secret {
  display: inline-block;
  font-size: 0.85rem;
  letter-spacing: 0.12em;
  padding: 0.3rem 0.6rem;
  border-radius: 6px;
  background: rgb(var(--v-theme-on-surface) / 0.06);
}
.acc__sessions {
  background: transparent;
}
</style>
