<template>
  <section>
    <h1>{{ $t('about') }}</h1>
    <p></p>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>
