<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import OnboardingSteps from '@/components/OnboardingSteps.vue'
import { useWebsiteDraftStore } from '@/stores/websiteDraft'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const router = useRouter()
const draftStore = useWebsiteDraftStore()

const busy = ref(false)
const error = ref('')
const toasts = useToastStore()
watch(error, (v) => { if (v) toasts.error(v) })

const businessName = ref('')

const canStart = computed(() => businessName.value.trim().length > 1)

async function start(): Promise<void> {
  if (!canStart.value || busy.value) return
  busy.value = true
  error.value = ''
  const ok = await draftStore.createAdvanced({
    businessName: businessName.value.trim(),
  })
  busy.value = false
  if (ok) void router.push({ name: 'create-account' })
  else error.value = draftStore.error === 'rate_limited' ? t('studio.rateLimited') : t('advanced.error')
}
</script>

<template>
  <v-container class="adv">
    <OnboardingSteps mode="advanced" current="pitch" class="adv__steps" />
    <header class="adv__head">
      <p class="adv__eyebrow"><span class="adv__dot" /> {{ t('advanced.pitchEyebrow') }}</p>
      <h1>{{ t('advanced.pitchTitle') }}</h1>
    </header>

    <form class="adv__form" @submit.prevent="start">
      <v-text-field
        v-model="businessName"
        :label="t('advanced.fieldName')"
        variant="outlined"
        density="comfortable"
        prepend-inner-icon="mdi-domain"
        autofocus
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
.adv__steps {
  margin-bottom: 1.5rem;
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

.adv__form {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.adv__fine {
  margin: 0;
  text-align: center;
  font-size: 0.76rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.adv__back {
  margin-top: 1rem;
  text-align: center;
}
</style>
