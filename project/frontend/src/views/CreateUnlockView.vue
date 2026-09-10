<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import OnboardingSteps from '@/components/OnboardingSteps.vue'
import { useBuilderStore } from '@/stores/builder'
import { useCompaniesStore } from '@/stores/companies'
import { useToastStore } from '@/stores/toast'

/**
 * Advanced-plan onboarding step: pay the one-time fee that unlocks the
 * page builder. Standalone — it drives only the `builder` store's `load` /
 * `unlock` actions and then hands off to the editor. The editor's own
 * `!unlocked` pay screen stays as a fallback for direct navigation.
 */
const { t, n } = useI18n()
const route = useRoute()
const router = useRouter()
const builder = useBuilderStore()
const companies = useCompaniesStore()
const { view, working } = storeToRefs(builder)

const companyId = ref<string | null>(null)
const ready = ref(false)
const error = ref('')
const toasts = useToastStore()
watch(error, (v) => { if (v) toasts.error(v) })

const price = computed(() => view.value?.priceCredits ?? 0)
const balance = computed(() => view.value?.wallet.balance.credits ?? 0)
const short = computed(() => Math.max(0, price.value - balance.value))
const funded = computed(() => short.value === 0)
const aiPlan = computed(() => view.value?.aiLimits?.plan ?? 6)
const aiSection = computed(() => view.value?.aiLimits?.section ?? 40)

const FEATURES = ['pages', 'sections', 'design', 'unlimited'] as const

const KNOWN_ERR = ['insufficient_credits', 'company_pending_deletion']
function errText(code: string): string {
  return KNOWN_ERR.includes(code) ? t('unlock.err.' + code) : t('unlock.error')
}

function toBuilder(): void {
  void router.replace({
    name: 'website-builder',
    query: { c: companyId.value, flow: 'onboarding' },
  })
}

async function pay(): Promise<void> {
  if (!companyId.value || working.value) return
  error.value = ''
  const ok = await builder.unlock(companyId.value)
  if (ok) toBuilder()
  else error.value = errText(builder.error)
}

onMounted(async () => {
  await companies.fetchOverview().catch(() => {})
  const id = companies.resolveId(route.query.c)
  if (!id) {
    void router.replace({ name: 'create' })
    return
  }
  companyId.value = id
  await builder.load(id)
  // Already paid (back-nav, refresh, resumed flow) → straight to the editor.
  if (view.value?.unlocked) {
    toBuilder()
    return
  }
  ready.value = true
})
</script>

<template>
  <v-container class="unl">
    <OnboardingSteps mode="advanced" current="unlock" class="unl__steps" />

    <header class="unl__head">
      <h1>{{ t('unlock.title') }}</h1>
      <p class="unl__lead">{{ t('unlock.lead') }}</p>
    </header>

    <div v-if="!ready" class="unl__loading">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <div v-else class="unl__card">
      <ul class="unl__feats">
        <li v-for="f in FEATURES" :key="f">
          <v-icon icon="mdi-check-circle-outline" size="17" />
          <span>{{ t('builder.feat.' + f) }}</span>
        </li>
        <li>
          <v-icon icon="mdi-check-circle-outline" size="17" />
          <span>{{ t('builder.feat.ai', { plan: aiPlan, section: aiSection }) }}</span>
        </li>
      </ul>

      <div class="unl__price">
        <span class="unl__priceLabel">{{ t('advanced.priceLabel') }}</span>
        <span class="unl__priceValue">{{ t('builder.priceValue', { credits: price }) }}</span>
      </div>
      <p class="unl__balance">{{ t('unlock.balance', { credits: n(balance, { maximumFractionDigits: 2 }) }) }}</p>

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
