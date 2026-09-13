<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import OnboardingSteps from '@/components/OnboardingSteps.vue'
import { useToastStore } from '@/stores/toast'
import { fetchPricing } from '@/services/platform'
import { apiFetch } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { useCompaniesStore } from '@/stores/companies'
import { useWebsiteDraftStore } from '@/stores/websiteDraft'
import type { WalletSummary } from '@/stores/wallet'

const { t, n } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const companies = useCompaniesStore()
const draftStore = useWebsiteDraftStore()
const { draft } = storeToRefs(draftStore)

const name = ref('')
const email = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')
// Gates the real content until `onMounted`'s validation (below) has actually
// settled — otherwise the form/signed-in card renders on the FIRST paint
// using whatever was already in the shared stores from the previous step,
// and only corrects (or redirects away) a moment later once the checks
// resolve. That's the visible "flash of another page" during the create
// flow. Stays `true` forever on a redirect branch — the spinner should keep
// showing until the browser actually navigates away, never flip back to
// this page's real content first.
const checking = ref(true)
const toasts = useToastStore()
watch(error, (v) => {
  if (v) toasts.error(v)
})

const price = ref(20)
const walletCredits = ref(0)

const businessName = computed(
  () => draft.value?.content?.pages?.[0]?.title || t('claim.yourBusiness'),
)
// An extra business (the user already owns at least one) costs credits,
// charged to the user's single wallet — unless it's an advanced-plan business,
// which already pays the advanced builder fee.
const isAdditional = computed(
  () =>
    auth.isAuthenticated &&
    companies.overview.length >= 1 &&
    draft.value?.mode !== 'advanced',
)
const canAfford = computed(() => walletCredits.value >= price.value)

const canSubmit = computed(
  () => name.value.trim() && /.+@.+\..+/.test(email.value) && password.value.length >= 8,
)

const KNOWN_ERR = [
  'insufficient_credits',
  'draft_already_claimed',
  'category_required',
  'additional_business_payment_required',
  'cannot_pay_from_that_company',
  'wallet_blocked',
]
function errText(code: string): string {
  return KNOWN_ERR.includes(code) ? t('claim.err.' + code) : t('claim.error')
}

/** The draft is ready to become a company only with a category AND a service area. */
function draftMissingLocation(): boolean {
  return !draft.value?.categorySlug || !draft.value?.location
}

async function finishClaim(): Promise<void> {
  const token = draftStore.token
  if (!token) {
    await router.replace({ name: 'create' })
    return
  }
  // Guard again at submit time: a stale/raced draft must not skip the
  // location + category step (it would create a company with no service area).
  if (draftMissingLocation()) {
    await router.replace({ name: 'create-location' })
    return
  }
  const isAdvanced = draft.value?.mode === 'advanced'
  const company = await companies.createFromDraft(token)
  draftStore.clearAfterClaim()
  // The account step isn't the end of onboarding — it hands off to the next
  // flow step. Advanced plans go to the dedicated "unlock the builder" payment
  // step; easy plans (site already built) go straight to the budget step.
  // Both carry `flow=onboarding` so the remaining steps show the progress strip
  // and route on to campaign activation.
  if (isAdvanced) {
    await router.replace({ name: 'create-unlock', query: { c: company.id, flow: 'onboarding' } })
  } else {
    await router.replace({ name: 'campaign-budget', query: { c: company.id, flow: 'onboarding' } })
  }
}

async function run(fn: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await fn()
  } catch (err) {
    const code = err instanceof Error ? err.message : ''
    error.value = errText(code)
  } finally {
    busy.value = false
  }
}

function submitNew(): void {
  if (!canSubmit.value) return
  void run(async () => {
    await auth.register({
      name: name.value.trim(),
      email: email.value.trim(),
      password: password.value,
    })
    await finishClaim()
  })
}
function claimExisting(): void {
  void run(finishClaim)
}

onMounted(async () => {
  const hasDraft = await draftStore.resumeIfAny()
  if (!hasDraft) {
    await router.replace({ name: 'create' })
    return
  }
  if (!draft.value?.ready) {
    await router.replace({ name: 'create-easy' })
    return
  }
  // A business can't be created without its category + service area.
  if (draftMissingLocation()) {
    await router.replace({ name: 'create-location' })
    return
  }
  if (auth.isAuthenticated) {
    // Was previously unguarded — `fetchOverview()` throws on any network
    // hiccup (it has no internal try/catch), which killed this WHOLE
    // `onMounted` silently and left `checking` stuck at `true` forever: a
    // permanent spinner that only a full page refresh could clear. Pricing/
    // wallet figures are a nice-to-have here (`isAdditional` still works off
    // `companies.overview`, defaulting to empty), so a soft-fail is correct.
    await companies.fetchOverview().catch(() => {})
    try {
      const [pricing, wal] = await Promise.all([
        fetchPricing(),
        apiFetch<WalletSummary>('/wallet'),
      ])
      price.value = pricing.additionalBusinessPriceCredits
      walletCredits.value = wal.balance.credits
    } catch {
      /* keep defaults */
    }
  }
  checking.value = false
})
</script>

<template>
  <v-container class="acc">
    <OnboardingSteps
      :mode="draft?.mode === 'advanced' ? 'advanced' : 'easy'"
      current="account"
      class="acc__steps"
    />
    <header class="acc__head">
      <p class="acc__eyebrow"><span class="acc__dot" /> {{ t('claim.eyebrow') }}</p>
      <h1>{{ t('claim.title') }}</h1>
      <p class="acc__lead">{{ t('claim.lead', { business: businessName }) }}</p>
    </header>

    <div v-if="checking" class="acc__loading">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <!-- Already signed in -->
    <div v-else-if="auth.isAuthenticated" class="acc__card">
      <p class="acc__signed">
        <v-icon icon="mdi-account-check-outline" size="18" />
        {{ t('claim.signedInAs', { email: auth.user?.email }) }}
      </p>

      <template v-if="isAdditional">
        <div class="acc__fee">
          <v-icon icon="mdi-information-outline" size="16" />
          {{ t('claim.additionalFee', { credits: price }) }}
        </div>
        <p class="acc__balance">
          {{ t('claim.walletBalance', { credits: n(walletCredits, { maximumFractionDigits: 2 }) }) }}
        </p>
        <div v-if="!canAfford" class="acc__short">
          <span>{{ t('claim.notEnough', { credits: price }) }}</span>
          <v-btn size="x-small" variant="tonal" color="primary" :to="{ name: 'wallet' }">
            {{ t('claim.addCredits') }}
          </v-btn>
        </div>
      </template>

      <v-btn
        color="primary"
        block
        :loading="busy"
        :disabled="isAdditional && !canAfford"
        append-icon="mdi-arrow-right"
        @click="claimExisting"
      >
        {{ isAdditional ? t('claim.finishPaid', { credits: price }) : t('claim.finish') }}
      </v-btn>
    </div>

    <!-- New account -->
    <form v-else class="acc__card" @submit.prevent="submitNew">
      <v-text-field
        v-model="name"
        :label="t('auth.name')"
        variant="outlined"
        density="comfortable"
        prepend-inner-icon="mdi-account-outline"
        autocomplete="name"
      />
      <v-text-field
        v-model="email"
        :label="t('auth.email')"
        type="email"
        variant="outlined"
        density="comfortable"
        prepend-inner-icon="mdi-email-outline"
        autocomplete="email"
      />
      <v-text-field
        v-model="password"
        :label="t('auth.password')"
        :hint="t('auth.passwordHint')"
        type="password"
        variant="outlined"
        density="comfortable"
        prepend-inner-icon="mdi-lock-outline"
        autocomplete="new-password"
        persistent-hint
      />
      <v-btn
        type="submit"
        color="primary"
        block
        size="large"
        :disabled="!canSubmit"
        :loading="busy"
        append-icon="mdi-arrow-right"
      >
        {{ t('claim.submit') }}
      </v-btn>
      <p class="acc__fineprint">{{ t('claim.saveNote') }}</p>
    </form>

    <div class="acc__back">
      <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" @click="router.back()">
        {{ t('claim.back') }}
      </v-btn>
    </div>
  </v-container>
</template>

<style scoped>
.acc {
  max-width: 460px;
  padding-block: clamp(2rem, 6vw, 4rem);
}
.acc__steps {
  margin-bottom: 1.5rem;
}
.acc__head {
  text-align: center;
  margin-bottom: 1.75rem;
}
.acc__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  font-weight: 600;
  color: var(--tvz-ai);
  margin: 0 0 0.6rem;
}
.acc__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tvz-ai);
  box-shadow: 0 0 0 4px var(--tvz-ai-soft);
}
.acc__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.5rem, 4vw, 2rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.acc__lead {
  margin: 0.6rem auto 0;
  max-width: 34ch;
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.95rem;
}
.acc__loading {
  display: grid;
  place-items: center;
  min-height: 160px;
}
.acc__card {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 1.5rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  box-shadow: var(--tvz-shadow-sm);
}
.acc__signed {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.5rem;
  font-size: 0.9rem;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.acc__fee {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.83rem;
  padding: 0.6rem 0.8rem;
  border-radius: var(--tvz-radius-md);
  background: var(--tvz-ai-soft);
}
.acc__balance {
  margin: 0;
  font-size: 0.83rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.acc__short {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-warning));
}
.acc__fineprint {
  margin: 0;
  font-size: 0.76rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-align: center;
}
.acc__error {
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
.acc__back {
  margin-top: 1rem;
  text-align: center;
}
</style>
