<script setup lang="ts">
import PasswordField from '@/components/PasswordField.vue'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AdsBuilderShell from '@/components/ads/AdsBuilderShell.vue'
import { ApiError } from '@/services/api'
import { useSeo } from '@/composables/useSeo'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { useGoogleAdsUserStore } from '@/stores/googleAdsUser'
import { clearDraftToken, googleAdsUserApi, readDraftToken } from '@/services/googleAdsUser'

/**
 * Step 3: bind the connected Google Ads campaign to a platform account,
 * the signed-in one, an existing one (sign in and come back) or a new one
 * created right here. Free; the dashboard opens right after.
 */
const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const toasts = useToastStore()
const adsStore = useGoogleAdsUserStore()
useSeo(() => ({ title: t('ads.account.seoTitle'), canonicalPath: '/google-ads/account' }))

const ready = ref(false)
const busy = ref(false)
const name = ref('')
const email = ref('')
const password = ref('')
const needsVerification = ref(false)
const code = ref('')

const canRegister = computed(
  () => name.value.trim().length >= 2 && /\S+@\S+\.\S+/.test(email.value) && password.value.length >= 8,
)

const VERIFY_ERR = ['code_invalid', 'code_expired', 'code_already_used', 'too_many_attempts']
const resendBusy = ref(false)
const resendCooldown = ref(false)
let resendTimer: ReturnType<typeof setTimeout> | undefined
onUnmounted(() => clearTimeout(resendTimer))

async function resend(): Promise<void> {
  if (resendBusy.value || resendCooldown.value) return
  resendBusy.value = true
  try {
    await auth.resendVerification(email.value.trim())
    toasts.success(t('verify.resendSent'))
    resendCooldown.value = true
    resendTimer = setTimeout(() => (resendCooldown.value = false), 45_000)
  } catch {
    toasts.error(t('verify.err.generic'))
  } finally {
    resendBusy.value = false
  }
}
/** Back to the form, e.g. to fix a mistyped email. */
function changeEmail(): void {
  needsVerification.value = false
  code.value = ''
}

function errText(e: unknown): string {
  const m = e instanceof ApiError ? e.message : ''
  if (VERIFY_ERR.includes(m)) return t('verify.err.' + m)
  if (m === 'campaign_managed_elsewhere') return t('ads.campaigns.managedElsewhere')
  if (/already|exist/i.test(m)) return t('ads.account.err.exists')
  if (/code/i.test(m)) return t('ads.account.err.code')
  return t('ads.account.err.generic')
}

async function claim(): Promise<void> {
  const { campaignId, campaignIds, taken } = await googleAdsUserApi.claim()
  clearDraftToken()
  await adsStore.fetch(true)
  const n = campaignIds?.length ?? 1
  toasts.success(n > 1 ? t('ads.account.doneN', { n }) : t('ads.account.done'))
  if (taken?.length) toasts.warning(t('ads.campaigns.taken', { names: taken.join(', ') }))
  void router.replace({ name: 'ads-dashboard', params: { id: campaignId }, query: { welcome: '1' } })
}

async function run(fn: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await fn()
  } catch (e) {
    toasts.error(errText(e))
  } finally {
    busy.value = false
  }
}

function continueSignedIn(): void {
  void run(claim)
}
function register(): void {
  if (!canRegister.value) return
  void run(async () => {
    const user = await auth.register({
      name: name.value.trim(),
      email: email.value.trim(),
      password: password.value,
    })
    if (!user.emailVerifiedAt) {
      needsVerification.value = true
      return
    }
    await auth.login({ email: email.value.trim(), password: password.value })
    await claim()
  })
}
function verify(): void {
  if (code.value.trim().length !== 6) return
  void run(async () => {
    await auth.verifyEmail(email.value.trim(), code.value.trim())
    await auth.login({ email: email.value.trim(), password: password.value })
    await claim()
  })
}

onMounted(async () => {
  if (!readDraftToken()) {
    void router.replace({ name: 'ads-connect' })
    return
  }
  try {
    const state = await googleAdsUserApi.state()
    if (state.status !== 'connected') {
      void router.replace({ name: 'ads-connect' })
      return
    }
    if (!state.selected && !state.selections?.length) {
      void router.replace({ name: 'ads-campaigns' })
      return
    }
  } catch {
    void router.replace({ name: 'ads-connect' })
    return
  }
  ready.value = true
})
</script>

<template>
  <AdsBuilderShell current="account" :title="t('ads.account.title')" :lead="t('ads.account.lead')">
    <div v-if="!ready" class="ab-center"><v-progress-circular indeterminate color="primary" /></div>

    <!-- Signed in: one click -->
    <div v-else-if="auth.isAuthenticated" class="ab-card" data-guide="ads-account-signed">
      <p class="aa__who">
        <v-icon icon="mdi-account-check-outline" size="20" />
        {{ t('ads.account.signedInAs', { name: auth.user?.name || auth.user?.email }) }}
      </p>
      <v-btn color="primary" size="large" block :loading="busy" append-icon="mdi-arrow-right" @click="continueSignedIn">
        {{ t('ads.account.continue') }}
      </v-btn>
    </div>

    <!-- Email verification after registering -->
    <div v-else-if="needsVerification" class="ab-card" data-guide="ads-account-verify">
      <p class="ab-note"><v-icon icon="mdi-email-check-outline" size="18" /> {{ t('verify.sentTo', { email }) }}</p>
      <v-text-field
        v-model="code"
        :label="t('verify.codeLabel')"
        inputmode="numeric"
        maxlength="6"
        autocomplete="one-time-code"
        @keyup.enter="verify"
      />
      <v-btn color="primary" size="large" block :loading="busy" :disabled="code.trim().length !== 6" @click="verify">
        {{ t('ads.account.verify') }}
      </v-btn>
      <v-btn variant="text" size="small" :disabled="resendCooldown" :loading="resendBusy" @click="resend">
        {{ resendCooldown ? t('verify.resendWait') : t('verify.resend') }}
      </v-btn>
      <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" @click="changeEmail">
        {{ t('verify.changeEmail') }}
      </v-btn>
    </div>

    <!-- New account or sign in -->
    <div v-else class="aa__grid">
      <form class="ab-card" data-guide="ads-account-new" @submit.prevent="register">
        <p class="aa__h">{{ t('ads.account.newTitle') }}</p>
        <v-text-field v-model="name" :label="t('ads.account.name')" autocomplete="name" />
        <v-text-field v-model="email" :label="t('ads.account.email')" type="email" autocomplete="email" />
        <PasswordField
          v-model="password"
          :label="t('ads.account.password')"
          autocomplete="new-password"
          :hint="t('ads.account.passwordHint')"
          persistent-hint
        />
        <v-btn type="submit" color="primary" size="large" block :loading="busy" :disabled="!canRegister">
          {{ t('ads.account.create') }}
        </v-btn>
      </form>
      <div class="ab-card aa__login" data-guide="ads-account-login">
        <p class="aa__h">{{ t('ads.account.haveAccount') }}</p>
        <p class="aa__text">{{ t('ads.account.loginText') }}</p>
        <v-btn
          variant="tonal"
          size="large"
          block
          prepend-icon="mdi-login-variant"
          :to="{ name: 'login', query: { redirect: '/google-ads/account' } }"
        >
          {{ t('ads.account.login') }}
        </v-btn>
      </div>
    </div>

    <p v-if="ready" class="ab-note aa__free"><v-icon icon="mdi-gift-outline" size="18" /> {{ t('ads.account.free') }}</p>

    <div class="ab-back">
      <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" :to="{ name: 'ads-campaigns' }">
        {{ t('ads.back') }}
      </v-btn>
    </div>
  </AdsBuilderShell>
</template>

<style scoped>
.aa__who {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-weight: 600;
}
.aa__grid {
  display: grid;
  gap: 1rem;
}
.aa__h {
  margin: 0;
  font-weight: 700;
  font-size: 1.02rem;
}
.aa__text {
  margin: 0;
  font-size: 0.9rem;
  color: rgba(var(--v-theme-on-surface), 0.66);
}
.aa__free {
  margin-top: 1rem;
}
</style>
