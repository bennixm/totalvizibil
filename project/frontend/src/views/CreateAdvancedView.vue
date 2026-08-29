<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AiThinking from '@/components/AiThinking.vue'
import { useDraftStore, type AdvancedDraftInput } from '@/stores/draft'
import { ApiError } from '@/services/api'

const { t } = useI18n()
const router = useRouter()
const draft = useDraftStore()

const form = reactive({
  businessName: '',
  businessType: '',
  city: '',
  region: '',
  services: [] as string[],
  shortDescription: '',
  targetAudience: '',
  toneOfVoice: 'professional' as NonNullable<AdvancedDraftInput['toneOfVoice']>,
  palette: 'indigo' as NonNullable<AdvancedDraftInput['palette']>,
  fontPair: 'grotesk-inter' as NonNullable<AdvancedDraftInput['fontPair']>,
  radius: 'soft' as NonNullable<AdvancedDraftInput['radius']>,
  primaryCta: '',
  includeFaq: true,
  includeTestimonials: false,
  seoKeywords: [] as string[],
  phone: '',
  email: '',
})

const error = ref<string | null>(null)
const generatingDone = ref(false)

const palettes = ['indigo', 'emerald', 'amber', 'slate', 'rose'] as const
const paletteHex: Record<string, string> = {
  indigo: '#4f46e5',
  emerald: '#059669',
  amber: '#d97706',
  slate: '#475569',
  rose: '#e11d48',
}
const tones = ['professional', 'friendly', 'premium', 'bold', 'calm']
const fonts = ['grotesk-inter', 'serif-sans', 'mono-sans']
const radii = ['sharp', 'soft', 'round']

const canSubmit = computed(
  () =>
    form.businessName.trim().length >= 2 &&
    form.businessType.trim().length >= 2 &&
    form.city.trim().length >= 2 &&
    form.services.length >= 1 &&
    form.shortDescription.trim().length >= 10,
)

async function submit() {
  if (!canSubmit.value) return
  error.value = null
  try {
    await draft.generate({
      mode: 'advanced',
      businessName: form.businessName.trim(),
      businessType: form.businessType.trim(),
      city: form.city.trim(),
      region: form.region.trim() || undefined,
      services: form.services.map((s) => s.trim()).filter(Boolean),
      shortDescription: form.shortDescription.trim(),
      targetAudience: form.targetAudience.trim() || undefined,
      toneOfVoice: form.toneOfVoice,
      palette: form.palette,
      fontPair: form.fontPair,
      radius: form.radius,
      primaryCta: form.primaryCta.trim() || undefined,
      includeFaq: form.includeFaq,
      includeTestimonials: form.includeTestimonials,
      seoKeywords: form.seoKeywords.length ? form.seoKeywords : undefined,
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
    })
    generatingDone.value = true
    setTimeout(() => router.push({ name: 'create-preview' }), 650)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('create.generateError')
  }
}
</script>

<template>
  <v-container class="ca">
    <div v-if="draft.generating || generatingDone" class="ca__generating">
      <h1>{{ t('create.buildingTitle') }}</h1>
      <p>{{ t('create.buildingText', { name: form.businessName }) }}</p>
      <AiThinking :done="generatingDone" />
    </div>

    <template v-else>
      <div class="ca__head">
        <v-btn :to="{ name: 'create' }" variant="text" size="small" prepend-icon="mdi-arrow-left">
          {{ t('common.back') }}
        </v-btn>
        <p class="ca__eyebrow">{{ t('create.advancedTitle') }}</p>
        <h1>{{ t('create.advancedHeadline') }}</h1>
        <p class="ca__lead">{{ t('create.advancedLead') }}</p>
      </div>

      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4" :text="error" />

      <v-form @submit.prevent="submit">
        <section class="ca__group">
          <h2>{{ t('create.groupBasics') }}</h2>
          <v-text-field v-model="form.businessName" :label="t('create.fieldName')" />
          <v-text-field v-model="form.businessType" :label="t('create.fieldType')" />
          <div class="ca__two">
            <v-text-field v-model="form.city" :label="t('create.fieldCity')" />
            <v-text-field v-model="form.region" :label="t('create.fieldRegion')" />
          </div>
          <v-combobox
            v-model="form.services"
            :label="t('create.fieldServices')"
            multiple
            chips
            closable-chips
          />
          <v-textarea
            v-model="form.shortDescription"
            :label="t('create.fieldDescription')"
            rows="3"
            auto-grow
          />
        </section>

        <section class="ca__group">
          <h2>{{ t('create.groupVoice') }}</h2>
          <v-text-field v-model="form.targetAudience" :label="t('create.fieldAudience')" />
          <v-select
            v-model="form.toneOfVoice"
            :items="tones.map((v) => ({ value: v, title: t(`create.tone_${v}`) }))"
            :label="t('create.fieldTone')"
          />
          <v-text-field
            v-model="form.primaryCta"
            :label="t('create.fieldCta')"
            :placeholder="t('create.fieldCtaPh')"
          />
        </section>

        <section class="ca__group">
          <h2>{{ t('create.groupBranding') }}</h2>
          <label class="ca__label">{{ t('create.fieldPalette') }}</label>
          <div class="ca__swatches">
            <button
              v-for="p in palettes"
              :key="p"
              type="button"
              class="swatch"
              :class="{ 'swatch--on': form.palette === p }"
              :style="{ '--sw': paletteHex[p] }"
              @click="form.palette = p"
            >
              <span />
              {{ t(`create.palette_${p}`) }}
            </button>
          </div>
          <div class="ca__two">
            <v-select
              v-model="form.fontPair"
              :items="fonts.map((v) => ({ value: v, title: t(`create.font_${v.replace('-', '_')}`) }))"
              :label="t('create.fieldFont')"
            />
            <v-select
              v-model="form.radius"
              :items="radii.map((v) => ({ value: v, title: t(`create.radius_${v}`) }))"
              :label="t('create.fieldRadius')"
            />
          </div>
        </section>

        <section class="ca__group">
          <h2>{{ t('create.groupSections') }}</h2>
          <v-switch
            v-model="form.includeFaq"
            :label="t('create.optFaq')"
            color="primary"
            hide-details
            density="comfortable"
          />
          <v-switch
            v-model="form.includeTestimonials"
            :label="t('create.optTestimonials')"
            color="primary"
            hide-details
            density="comfortable"
          />
          <v-combobox
            v-model="form.seoKeywords"
            :label="t('create.fieldSeo')"
            multiple
            chips
            closable-chips
            class="mt-3"
          />
          <div class="ca__two">
            <v-text-field v-model="form.phone" :label="t('create.fieldPhone')" type="tel" />
            <v-text-field v-model="form.email" :label="t('create.fieldEmail')" type="email" />
          </div>
        </section>

        <v-btn
          type="submit"
          color="primary"
          size="large"
          rounded="pill"
          :disabled="!canSubmit"
          append-icon="mdi-sparkles"
        >
          {{ t('create.generateCta') }}
        </v-btn>
      </v-form>
    </template>
  </v-container>
</template>

<style scoped>
.ca {
  max-width: 680px;
  padding-block: clamp(2rem, 6vw, 4rem);
}
.ca__head {
  margin-bottom: 1.6rem;
}
.ca__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 11px;
  font-weight: 600;
  color: var(--tvz-ai);
  margin: 1rem 0 0.5rem;
}
.ca__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.7rem, 4.5vw, 2.4rem);
  letter-spacing: -0.02em;
  margin: 0;
}
.ca__lead {
  margin: 0.7rem 0 0;
  color: rgb(var(--v-theme-on-surface) / 0.66);
}
.ca__group {
  margin-bottom: 1.6rem;
  padding-bottom: 1.4rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.ca__group:last-of-type {
  border-bottom: none;
}
.ca__group h2 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
  margin: 0 0 1rem;
}
.ca__two {
  display: grid;
  gap: 0.4rem;
  grid-template-columns: 1fr 1fr;
}
@media (max-width: 560px) {
  .ca__two {
    grid-template-columns: 1fr;
  }
}
.ca__label {
  display: block;
  font-size: 0.8rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
  margin-bottom: 0.5rem;
}
.ca__swatches {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.swatch {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  font-size: 0.8rem;
  cursor: pointer;
}
.swatch span {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--sw);
}
.swatch--on {
  border-color: var(--sw);
  box-shadow: 0 0 0 1px var(--sw);
}
.ca__generating {
  text-align: center;
  padding: clamp(2rem, 8vw, 5rem) 1rem;
}
.ca__generating h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.6rem, 4vw, 2.2rem);
  margin: 0 0 0.5rem;
}
.ca__generating p {
  color: rgb(var(--v-theme-on-surface) / 0.66);
  margin: 0;
}
</style>
