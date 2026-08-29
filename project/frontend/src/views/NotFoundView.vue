<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <v-container class="py-16">
    <div class="page-container text-center d-flex flex-column align-center ga-4">
      <div class="text-h1 font-weight-bold text-primary">404</div>
      <h1 class="text-h5 font-weight-bold">{{ t('errors.notFoundTitle') }}</h1>
      <p class="text-body-1 text-medium-emphasis">{{ t('errors.notFoundText') }}</p>
      <v-btn :to="{ name: 'home' }" color="primary" variant="flat">
        {{ t('errors.goHome') }}
      </v-btn>
    </div>
  </v-container>
</template>
