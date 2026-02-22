<template>
  <v-app-bar color="primary" dark>
    <v-toolbar-title>{{ t('home') }}</v-toolbar-title>
    <v-spacer>{{ t('welcome') }}</v-spacer>
  </v-app-bar>
</template>


<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>
