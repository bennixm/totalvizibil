<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

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
const { draft, loading } = storeToRefs(draftStore)

const name = ref('')
const email = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')

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

const KNOWN_ERR = ['insufficient_credits', 'draft_already_claimed', 'category_required']
function errText(code: string): string {
  return KNOWN_ERR.includes(code) ? t('claim.err.' + code) : t('claim.error')
}

async function finishClaim(): Promise<void> {
  const token = draftStore.token
  if (!token) {
    await router.replace({ name: 'create' })
    return
  }
  const company = await companies.createFromDraft(token)
  draftStore.clearAfterClaim()
  await router.replace({ name: 'dashboard', query: { c: company.id } })
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
    void router.replace({ name: 'create' })
    return
  }
  if (!draft.value?.ready) {
    void router.replace({ name: 'create-easy' })
    return
  }
  // A business can't be created without its category + service area.
  if (!draft.value.categorySlug || !draft.value.location) {
    void router.replace({ name: 'create-location' })
    return
  }
  if (auth.isAuthenticated) {
    await companies.fetchOverview()
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
})
</script>

<template>
  <v-container class="acc">
    <header class="acc__head">
      <p class="acc__eyebrow"><span class="acc__dot" /> {{ t('claim.eyebrow') }}</p>
      <h1>{{ t('claim.title') }}</h1>
      <p class="acc__lead">{{ t('claim.lead', { business: businessName }) }}</p>
    </header>

    <div v-if="loading && !draft" class="acc__loading">
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

    <div v-if="error" class="acc__error">
      <v-icon icon="mdi-alert-circle-outline" size="18" /> {{ error }}
    </div>

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
  color: rgb(var(--v-theme-on-surface) / 0.66);
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
  color: rgb(var(--v-theme-on-surface) / 0.75);
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
  color: rgb(var(--v-theme-on-surface) / 0.7);
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
  color: rgb(var(--v-theme-on-surface) / 0.5);
  text-align: center;
}
.acc__error {
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
.acc__back {
  margin-top: 1rem;
  text-align: center;
}
</style>
