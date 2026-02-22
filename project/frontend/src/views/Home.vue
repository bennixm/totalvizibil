<template>
  <v-app-bar color="primary" dark>
    <v-toolbar-title>{{ t('home') }}</v-toolbar-title>
    <v-spacer>{{ t('welcome') }}</v-spacer>
    <AutoComplete v-model="value" :suggestions="items" @complete="search" />
  </v-app-bar>
</template>


<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()

import AutoComplete from 'primevue/autocomplete';
</script>
