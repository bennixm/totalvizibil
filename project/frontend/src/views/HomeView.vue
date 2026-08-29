<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AuroraBackdrop from '@/components/AuroraBackdrop.vue'

const { t } = useI18n()

const features = computed(() => [
  {
    icon: 'mdi-robot-happy-outline',
    title: t('home.features.onboardingTitle'),
    text: t('home.features.onboardingText'),
  },
  {
    icon: 'mdi-web',
    title: t('home.features.websiteTitle'),
    text: t('home.features.websiteText'),
  },
  {
    icon: 'mdi-chart-line',
    title: t('home.features.trafficTitle'),
    text: t('home.features.trafficText'),
  },
])
</script>

<template>
  <!-- Hero -->
  <section class="hero">
    <AuroraBackdrop />
    <div class="page-container hero__inner">
      <v-chip variant="outlined" size="small" class="tvz-glass mb-6" prepend-icon="mdi-star-four-points">
        {{ t('home.eyebrow') }}
      </v-chip>

      <h1 class="text-h3 text-md-h2 font-weight-bold text-balance mb-4">
        <span class="text-gradient">{{ t('home.heroTitle') }}</span>
      </h1>

      <p class="text-body-1 text-md-h6 font-weight-regular text-medium-emphasis text-balance mx-auto mb-8">
        {{ t('home.heroSubtitle') }}
      </p>

      <div class="d-flex ga-3 flex-wrap justify-center">
        <v-btn
          :to="{ name: 'onboarding' }"
          color="primary"
          size="x-large"
          variant="flat"
          rounded="pill"
          class="tvz-glow"
          append-icon="mdi-arrow-right"
        >
          {{ t('home.ctaBusiness') }}
        </v-btn>
        <v-btn
          :to="{ name: 'search' }"
          size="x-large"
          variant="outlined"
          rounded="pill"
          class="tvz-glass"
        >
          {{ t('home.ctaCustomer') }}
        </v-btn>
      </div>
    </div>
  </section>

  <!-- Features -->
  <section class="section">
    <div class="page-container">
      <h2 class="text-h4 font-weight-bold text-balance mb-10">{{ t('home.featuresTitle') }}</h2>

      <v-row>
        <v-col v-for="feature in features" :key="feature.title" cols="12" md="4">
          <div class="tvz-card tvz-card--interactive pa-6 h-100">
            <div class="feature__icon mb-4">
              <v-icon :icon="feature.icon" size="26" />
            </div>
            <h3 class="text-h6 font-weight-bold mb-2">{{ feature.title }}</h3>
            <p class="text-body-2 text-medium-emphasis mb-0">{{ feature.text }}</p>
          </div>
        </v-col>
      </v-row>
    </div>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  overflow: hidden;
  padding-block: clamp(5rem, 12vw, 9rem);
  text-align: center;
}

.hero__inner {
  position: relative;
  z-index: 1;
}

.hero p {
  max-width: 62ch;
}

.feature__icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: var(--tvz-radius-md);
  color: #fff;
  background: var(--tvz-gradient-brand);
  box-shadow: var(--tvz-glow-primary);
}
</style>
