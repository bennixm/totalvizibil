<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { fetchPricing } from '@/services/platform'
import { useWebsiteDraftStore } from '@/stores/websiteDraft'

const { t, n } = useI18n()
const router = useRouter()
const draftStore = useWebsiteDraftStore()

const priceCredits = ref<number | null>(null)
const eurRonRate = ref(5.05)
const busy = ref(false)
const error = ref('')

const businessName = ref('')
const businessType = ref('')
const city = ref('')

const canStart = computed(
  () => businessName.value.trim().length > 1 && businessType.value.trim().length > 2,
)
const ronApprox = computed(() =>
  priceCredits.value ? Math.round(priceCredits.value * eurRonRate.value) : null,
)

const perks = ['pages', 'design', 'portfolio', 'sections'] as const

async function start(): Promise<void> {
  if (!canStart.value || busy.value) return
  busy.value = true
  error.value = ''
  const ok = await draftStore.createAdvanced({
    businessName: businessName.value.trim(),
    businessType: businessType.value.trim(),
    city: city.value.trim() || undefined,
  })
  busy.value = false
  if (ok) void router.push({ name: 'create-account' })
  else error.value = draftStore.error || t('advanced.error')
}

onMounted(async () => {
  try {
    const p = await fetchPricing()
    priceCredits.value = p.advancedBuilderPriceCredits
    eurRonRate.value = p.eurRonRate
  } catch {
    priceCredits.value = null
  }
})
</script>

<template>
  <v-container class="adv">
    <header class="adv__head">
      <p class="adv__eyebrow"><span class="adv__dot" /> {{ t('advanced.eyebrow') }}</p>
      <h1>{{ t('advanced.title') }}</h1>
      <p class="adv__lead">{{ t('advanced.lead') }}</p>
    </header>

    <div class="adv__price">
      <div>
        <span class="adv__priceLabel">{{ t('advanced.priceLabel') }}</span>
        <strong v-if="priceCredits != null">
          {{ t('advanced.priceValue', { credits: priceCredits }) }}
        </strong>
        <strong v-else>—</strong>
        <span v-if="priceCredits != null" class="adv__priceEq">
          ≈ €{{ n(priceCredits, { maximumFractionDigits: 0 }) }} /
          ~{{ n(ronApprox ?? 0, { maximumFractionDigits: 0 }) }} RON
        </span>
      </div>
      <p class="adv__priceNote">{{ t('advanced.priceNote') }}</p>
    </div>

    <ul class="adv__perks">
      <li v-for="p in perks" :key="p">
        <v-icon icon="mdi-check" size="16" /> {{ t('advanced.perk.' + p) }}
      </li>
    </ul>

    <form class="adv__form" @submit.prevent="start">
      <v-text-field
        v-model="businessName"
        :label="t('advanced.fieldName')"
        variant="outlined"
        density="comfortable"
        prepend-inner-icon="mdi-domain"
      />
      <v-text-field
        v-model="businessType"
        :label="t('advanced.fieldType')"
        :placeholder="t('advanced.fieldTypePlaceholder')"
        variant="outlined"
        density="comfortable"
        prepend-inner-icon="mdi-shape-outline"
      />
      <v-text-field
        v-model="city"
        :label="t('advanced.fieldCity')"
        variant="outlined"
        density="comfortable"
        prepend-inner-icon="mdi-map-marker-outline"
      />
      <v-btn
        type="submit"
        color="primary"
        block
        size="large"
        :disabled="!canStart"
        :loading="busy"
        append-icon="mdi-arrow-right"
      >
        {{ t('advanced.cta') }}
      </v-btn>
      <p class="adv__fine">{{ t('advanced.flowNote') }}</p>
    </form>

    <div v-if="error" class="adv__error">
      <v-icon icon="mdi-alert-circle-outline" size="18" /> {{ error }}
    </div>

    <div class="adv__back">
      <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" :to="{ name: 'create' }">
        {{ t('advanced.back') }}
      </v-btn>
    </div>
  </v-container>
</template>

<style scoped>
.adv {
  max-width: 520px;
  padding-block: clamp(2rem, 6vw, 4rem);
}
.adv__head {
  text-align: center;
  margin-bottom: 1.5rem;
}
.adv__eyebrow {
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
.adv__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tvz-ai);
  box-shadow: 0 0 0 4px var(--tvz-ai-soft);
}
.adv__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.6rem, 4vw, 2.2rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.adv__lead {
  margin: 0.6rem auto 0;
  max-width: 40ch;
  color: rgb(var(--v-theme-on-surface) / 0.66);
  font-size: 0.95rem;
}

.adv__price {
  padding: 1.25rem 1.5rem;
  border-radius: var(--tvz-radius-lg);
  border: 1px solid var(--tvz-glass-border);
  background: var(--tvz-ai-soft);
  text-align: center;
}
.adv__priceLabel {
  display: block;
  font-size: 0.78rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.adv__price strong {
  display: block;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.9rem;
  font-weight: 700;
  margin: 0.2rem 0;
}
.adv__priceEq {
  font-size: 0.85rem;
  color: rgb(var(--v-theme-on-surface) / 0.7);
}
.adv__priceNote {
  margin: 0.6rem 0 0;
  font-size: 0.76rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}

.adv__perks {
  list-style: none;
  padding: 0;
  margin: 1.25rem 0;
  display: grid;
  gap: 0.4rem;
}
.adv__perks li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.88rem;
  color: rgb(var(--v-theme-on-surface) / 0.8);
}
.adv__perks .v-icon {
  color: rgb(var(--v-theme-success));
}

.adv__form {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.adv__fine {
  margin: 0;
  text-align: center;
  font-size: 0.76rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.adv__error {
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
.adv__back {
  margin-top: 1rem;
  text-align: center;
}
</style>
