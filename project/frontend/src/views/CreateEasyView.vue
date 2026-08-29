<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AiThinking from '@/components/AiThinking.vue'
import { useDraftStore } from '@/stores/draft'
import { ApiError } from '@/services/api'

const { t } = useI18n()
const router = useRouter()
const draft = useDraftStore()

const businessName = ref('')
const businessType = ref('')
const city = ref('')
const services = ref<string[]>([])
const shortDescription = ref('')
const error = ref<string | null>(null)
const generatingDone = ref(false)

const canSubmit = computed(
  () =>
    businessName.value.trim().length >= 2 &&
    businessType.value.trim().length >= 2 &&
    city.value.trim().length >= 2 &&
    services.value.length >= 1 &&
    shortDescription.value.trim().length >= 10,
)

async function submit() {
  if (!canSubmit.value) return
  error.value = null
  try {
    await draft.generate({
      mode: 'easy',
      businessName: businessName.value.trim(),
      businessType: businessType.value.trim(),
      city: city.value.trim(),
      services: services.value.map((s) => s.trim()).filter(Boolean),
      shortDescription: shortDescription.value.trim(),
    })
    generatingDone.value = true
    setTimeout(() => router.push({ name: 'create-preview' }), 650)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('create.generateError')
  }
}
</script>

<template>
  <v-container class="ce">
    <!-- Generating overlay -->
    <div v-if="draft.generating || generatingDone" class="ce__generating">
      <h1>{{ t('create.buildingTitle') }}</h1>
      <p>{{ t('create.buildingText', { name: businessName }) }}</p>
      <AiThinking :done="generatingDone" />
    </div>

    <template v-else>
      <div class="ce__head">
        <v-btn :to="{ name: 'create' }" variant="text" size="small" prepend-icon="mdi-arrow-left">
          {{ t('common.back') }}
        </v-btn>
        <p class="ce__eyebrow">{{ t('create.easyTitle') }}</p>
        <h1>{{ t('create.easyHeadline') }}</h1>
        <p class="ce__lead">{{ t('create.easyLead') }}</p>
      </div>

      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4" :text="error" />

      <v-form class="ce__form" @submit.prevent="submit">
        <v-text-field
          v-model="businessName"
          :label="t('create.fieldName')"
          :placeholder="t('create.fieldNamePh')"
          autofocus
        />
        <v-text-field
          v-model="businessType"
          :label="t('create.fieldType')"
          :placeholder="t('create.fieldTypePh')"
          :hint="t('create.fieldTypeHint')"
        />
        <v-text-field v-model="city" :label="t('create.fieldCity')" :placeholder="t('create.fieldCityPh')" />
        <v-combobox
          v-model="services"
          :label="t('create.fieldServices')"
          :placeholder="t('create.fieldServicesPh')"
          multiple
          chips
          closable-chips
          :hint="t('create.fieldServicesHint')"
          persistent-hint
        />
        <v-textarea
          v-model="shortDescription"
          :label="t('create.fieldDescription')"
          :placeholder="t('create.fieldDescriptionPh')"
          rows="3"
          auto-grow
          counter="600"
        />

        <v-btn
          type="submit"
          color="primary"
          size="large"
          rounded="pill"
          :disabled="!canSubmit"
          append-icon="mdi-sparkles"
          class="mt-2"
        >
          {{ t('create.generateCta') }}
        </v-btn>
      </v-form>
    </template>
  </v-container>
</template>

<style scoped>
.ce {
  max-width: 640px;
  padding-block: clamp(2rem, 6vw, 4rem);
}
.ce__head {
  margin-bottom: 1.8rem;
}
.ce__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 11px;
  font-weight: 600;
  color: var(--tvz-ai);
  margin: 1rem 0 0.5rem;
}
.ce__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.7rem, 4.5vw, 2.4rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.ce__lead {
  margin: 0.7rem 0 0;
  color: rgb(var(--v-theme-on-surface) / 0.66);
}
.ce__form {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.ce__generating {
  text-align: center;
  padding: clamp(2rem, 8vw, 5rem) 1rem;
}
.ce__generating h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.6rem, 4vw, 2.2rem);
  letter-spacing: -0.02em;
  margin: 0 0 0.5rem;
}
.ce__generating p {
  color: rgb(var(--v-theme-on-surface) / 0.66);
  margin: 0;
}
</style>
