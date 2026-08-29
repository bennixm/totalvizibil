<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { apiFetch, ApiError } from '@/services/api'

const { t } = useI18n()

const email = ref('')
const loading = ref(false)
const sent = ref(false)
const devUrl = ref<string | null>(null)
const error = ref<string | null>(null)

async function submit() {
  loading.value = true
  error.value = null
  try {
    const res = await apiFetch<{ ok: true; devResetUrl?: string }>('/auth/password/forgot', {
      method: 'POST',
      body: { email: email.value.trim() },
    })
    sent.value = true
    devUrl.value = res.devResetUrl ?? null
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('auth.genericError')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <v-container class="py-12">
    <v-row justify="center">
      <v-col cols="12" sm="8" md="5" lg="4">
        <v-card border flat class="pa-4 tvz-card">
          <v-card-item>
            <v-card-title class="text-h5 font-weight-bold font-display">
              {{ t('reset.forgotTitle') }}
            </v-card-title>
            <v-card-subtitle class="text-wrap">{{ t('reset.forgotSubtitle') }}</v-card-subtitle>
          </v-card-item>

          <v-card-text>
            <template v-if="!sent">
              <v-alert
                v-if="error"
                type="error"
                variant="tonal"
                density="compact"
                class="mb-4"
                :text="error"
              />
              <v-form @submit.prevent="submit">
                <v-text-field
                  v-model="email"
                  :label="t('auth.email')"
                  type="email"
                  autocomplete="email"
                  prepend-inner-icon="mdi-email-outline"
                  required
                />
                <v-btn
                  type="submit"
                  color="primary"
                  variant="flat"
                  rounded="pill"
                  block
                  class="mt-2"
                  :loading="loading"
                >
                  {{ t('reset.sendLink') }}
                </v-btn>
              </v-form>
            </template>

            <template v-else>
              <v-alert type="success" variant="tonal" density="comfortable" class="mb-3">
                {{ t('reset.sentText') }}
              </v-alert>
              <v-alert
                v-if="devUrl"
                type="info"
                variant="tonal"
                density="comfortable"
                icon="mdi-flask-outline"
              >
                <div class="text-caption mb-1">{{ t('reset.devNote') }}</div>
                <router-link :to="devUrl.replace(/^https?:\/\/[^/]+/, '')" class="text-body-2">
                  {{ t('reset.devOpen') }}
                </router-link>
              </v-alert>
            </template>
          </v-card-text>

          <v-card-actions>
            <v-btn :to="{ name: 'login' }" variant="text" size="small" prepend-icon="mdi-arrow-left">
              {{ t('reset.backToLogin') }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>
