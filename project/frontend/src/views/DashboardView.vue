<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const cards = computed(() => [
  { key: 'credit', icon: 'mdi-wallet-outline', value: '—' },
  { key: 'traffic', icon: 'mdi-chart-areaspline', value: '—' },
  { key: 'clicks', icon: 'mdi-cursor-default-click-outline', value: '—' },
  { key: 'calls', icon: 'mdi-phone-outline', value: '—' },
  { key: 'leads', icon: 'mdi-email-outline', value: '—' },
])

const sections = ['overview', 'website', 'marketing', 'credit', 'assistant'] as const
</script>

<template>
  <v-container class="py-10">
    <div class="page-container d-flex flex-column ga-6">
      <div class="d-flex align-center ga-3">
        <h1 class="text-h4 font-weight-bold">{{ t('dashboard.title') }}</h1>
        <v-chip size="small" color="primary" variant="tonal">Phase 1</v-chip>
      </div>

      <v-tabs :model-value="0" color="primary" show-arrows>
        <v-tab v-for="section in sections" :key="section">
          {{ t(`dashboard.${section}`) }}
        </v-tab>
      </v-tabs>

      <v-row>
        <v-col v-for="card in cards" :key="card.key" cols="6" sm="4" md="3" lg="2">
          <v-card border flat class="pa-2">
            <v-card-item>
              <v-icon :icon="card.icon" color="primary" class="mb-2" />
              <div class="text-caption text-medium-emphasis">
                {{ t(`dashboard.cards.${card.key}`) }}
              </div>
              <div class="text-h6 font-weight-bold">{{ card.value }}</div>
            </v-card-item>
          </v-card>
        </v-col>
      </v-row>
    </div>
  </v-container>
</template>
