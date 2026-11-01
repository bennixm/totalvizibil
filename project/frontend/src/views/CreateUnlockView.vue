<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import OnboardingSteps from '@/components/OnboardingSteps.vue'
import { useAdvancedUnlockStore } from '@/stores/advanced-unlock'
import { useCompaniesStore } from '@/stores/companies'
import { useToastStore } from '@/stores/toast'

/**
 * Advanced-plan onboarding step: pay the one-time fee that unlocks the
 * Website Builder. Standalone — it drives only the unlock store's `load` /
 * `unlock` actions and then hands off to the builder, which re-checks the
 * same unlock flag server-side on every call (so direct navigation can't
 * skip paying).
 */
const { t, n } = useI18n()
const route = useRoute()
const router = useRouter()
const unlock = useAdvancedUnlockStore()
const companies = useCompaniesStore()
const { view, working } = storeToRefs(unlock)

const companyId = ref<string | null>(null)
const ready = ref(false)
const error = ref('')
/** The INITIAL load failed. Without this the view fell through to its
 *  zero-initialised defaults — price 0, balance 0 — which made `funded`
 *  trivially true and rendered an enabled "Unlock for 0 credits" button that
 *  could only ever fail against the backend. */
const loadError = ref('')
const toasts = useToastStore()
watch(error, (v) => { if (v) toasts.error(v) })

const price = computed(() => view.value?.priceCredits ?? 0)
const balance = computed(() => view.value?.wallet.balance.credits ?? 0)
const bonus = computed(() => view.value?.bonusCredits ?? 0)
const short = computed(() => Math.max(0, price.value - balance.value))
const funded = computed(() => short.value === 0)

const FEATURES = ['pages', 'ai', 'design', 'unlimited'] as const

const KNOWN_ERR = ['insufficient_credits', 'company_pending_deletion']
function errText(code: string): string {
  if (KNOWN_ERR.includes(code)) return t('unlock.err.' + code)
  if (/cannot edit this project/i.test(code)) return t('unlock.err.forbidden')
  if (code === 'Company not found') return t('unlock.err.not_found')
  return t('unlock.error')
}

async function retryLoad(): Promise<void> {
  if (!companyId.value) return
  loadError.value = ''
  await unlock.load(companyId.value)
  if (unlock.error) {
    loadError.value = errText(unlock.error)
    return
  }
  if (view.value?.unlocked) {
    void toBuilder()
    return
  }
  ready.value = true
}

/** `flow=upgrade` marks an already-active business paying to upgrade its
 *  plan, as opposed to a brand-new signup still walking the onboarding
 *  wizard — the step strip and the onward "continue onboarding" hand-off
 *  both only make sense for the latter. */
const isUpgrade = computed(() => route.query.flow === 'upgrade')

async function toBuilder(): Promise<void> {
  // The builder's own mount guard reads `companies.overview` (cached — see
  // `fetchOverview()`) to decide whether the unlock actually went through,
  // and bounces back here if it still looks locked. That overview was last
  // fetched BEFORE this unlock (on this view's own mount, a few lines up),
  // so without a forced refresh here it's stale the instant we paid: the
  // builder sees `builderUnlocked: false`, redirects back to this exact
  // screen, which re-checks via `unlock.load()` (not the stale cache) and
  // sees `unlocked: true`, so it sends the user right back to the builder —
  // which reads the still-stale cache again. The two screens volley forever
  // until the backend's own rate limiter cuts in, at which point the user
  // sees a generic "couldn't load" error despite having already paid
  // successfully. Refreshing the cache here, before the one navigation that
  // depends on it being current, is the one place that actually breaks the
  // loop.
  await companies.fetchOverview(true).catch(() => {})
  void router.replace({
    name: 'website-builder',
    query: isUpgrade.value
      ? { c: companyId.value }
      : { c: companyId.value, flow: 'onboarding' },
  })
}

async function pay(): Promise<void> {
  if (!companyId.value || working.value) return
  error.value = ''
  const ok = await unlock.unlock(companyId.value)
  if (ok) void toBuilder()
  else error.value = errText(unlock.error)
}

onMounted(async () => {
  await companies.fetchOverview().catch(() => {})
  const id = companies.resolveId(route.query.c)
  if (!id) {
    void router.replace({ name: 'create' })
    return
  }
  companyId.value = id
  await unlock.load(id)
  // The load's own error state must be checked BEFORE deciding anything else
  // — a 403/404/network failure leaves price and balance at 0, which would
  // otherwise render an enabled "Unlock for 0 credits" button.
  if (unlock.error) {
    loadError.value = errText(unlock.error)
    return
  }
  // Already paid (back-nav, refresh, resumed flow) → straight to the editor.
  if (view.value?.unlocked) {
    void toBuilder()
    return
  }
  ready.value = true
})
</script>

<template>
  <v-container class="unl">
    <OnboardingSteps v-if="!isUpgrade" mode="advanced" current="unlock" class="unl__steps" />

    <header class="unl__head">
      <h1>{{ t('unlock.title') }}</h1>
      <p class="unl__lead">{{ t('unlock.lead') }}</p>
    </header>

    <div v-if="loadError" class="unl__loadError">
      <v-icon icon="mdi-alert-circle-outline" size="30" />
      <h2>{{ t('unlock.loadErrorTitle') }}</h2>
      <p>{{ loadError }}</p>
      <v-btn color="primary" variant="tonal" size="small" prepend-icon="mdi-refresh" :loading="unlock.loading" @click="retryLoad">
        {{ t('common.retry') }}
      </v-btn>
    </div>

    <div v-else-if="!ready" class="unl__loading">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <div v-else class="unl__card">
      <ul class="unl__feats">
        <li v-for="f in FEATURES" :key="f">
          <v-icon icon="mdi-check-circle-outline" size="17" />
          <span>{{ t('builder.feat.' + f) }}</span>
        </li>
      </ul>

      <div class="unl__price">
        <span class="unl__priceLabel">{{ t('advanced.priceLabel') }}</span>
        <span class="unl__priceValue">{{ t('builder.priceValue', { credits: price }) }}</span>
      </div>
      <p class="unl__balance">{{ t('unlock.balance', { credits: n(balance, { maximumFractionDigits: 2 }) }) }}</p>
      <p v-if="bonus > 0" class="unl__bonus">
        <v-icon icon="mdi-gift-outline" size="15" />
        {{ t('unlock.bonus', { credits: n(bonus, { maximumFractionDigits: 2 }) }) }}
      </p>

      <div v-if="!funded" class="unl__short">
        <span>{{ t('unlock.short', { credits: n(short, { maximumFractionDigits: 2 }) }) }}</span>
        <v-btn size="x-small" variant="tonal" color="primary" :to="{ name: 'wallet' }">
          {{ t('unlock.addCredits') }}
        </v-btn>
      </div>

      <v-btn
        color="primary"
        block
        size="large"
        :loading="working"
        :disabled="!funded"
        append-icon="mdi-arrow-right"
        @click="pay"
      >
        {{ t('unlock.pay', { credits: price }) }}
      </v-btn>
    </div>

    <div class="unl__back">
      <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" @click="router.back()">
        {{ t('unlock.back') }}
      </v-btn>
    </div>
  </v-container>
</template>

<style scoped>
.unl {
  max-width: 520px;
  padding-block: clamp(2rem, 6vw, 4rem);
}
.unl__steps {
  margin-bottom: 1.75rem;
}
.unl__head {
  text-align: center;
  margin-bottom: 1.5rem;
}
.unl__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.5rem, 4vw, 2rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.unl__lead {
  margin: 0.6rem auto 0;
  max-width: 42ch;
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.95rem;
}
.unl__loading {
  display: grid;
  place-items: center;
  min-height: 160px;
}
.unl__card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  box-shadow: var(--tvz-shadow-sm);
}
.unl__feats {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.unl__feats li {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  font-size: 0.9rem;
  line-height: 1.45;
}
.unl__feats .v-icon {
  color: rgb(var(--v-theme-primary));
  margin-top: 0.1rem;
  flex: none;
}
.unl__price {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.6rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--tvz-hairline);
}
.unl__priceLabel {
  font-size: 0.85rem;
  color: rgba(var(--v-theme-on-surface), 0.66);
}
.unl__priceValue {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: 1.15rem;
}
.unl__balance {
  margin: -0.4rem 0 0;
  font-size: 0.82rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.unl__bonus {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: -0.5rem 0 0;
  font-size: 0.82rem;
  color: rgb(var(--v-theme-success));
}
.unl__loadError {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  min-height: 200px;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.unl__loadError .v-icon {
  color: rgb(var(--v-theme-error));
}
.unl__loadError h2 {
  margin: 0;
  font-size: 1.05rem;
  color: rgb(var(--v-theme-on-surface));
}
.unl__loadError p {
  margin: 0;
  max-width: 40ch;
  font-size: 0.86rem;
}
.unl__short {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-warning));
}
.unl__error {
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
.unl__back {
  margin-top: 1rem;
  text-align: center;
}
</style>
