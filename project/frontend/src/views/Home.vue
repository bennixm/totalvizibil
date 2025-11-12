<template>
  <section>
    <h1>{{ t('home') }}</h1>
    <p>Bine ai venit în aplicația mea Vue + TypeScript!</p>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>
