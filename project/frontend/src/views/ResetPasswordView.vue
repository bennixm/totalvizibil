<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { apiFetch, ApiError } from '@/services/api'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))
const password = ref('')
const confirm = ref('')
const loading = ref(false)
const done = ref(false)
const error = ref<string | null>(null)

const mismatch = computed(() => confirm.value.length > 0 && password.value !== confirm.value)
const canSubmit = computed(
  () => token.value.length > 0 && password.value.length >= 8 && !mismatch.value,
)

async function submit() {
  if (!canSubmit.value) return
  loading.value = true
  error.value = null
  try {
    await apiFetch('/auth/password/reset', {
      method: 'POST',
      body: { token: token.value, password: password.value },
    })
    done.value = true
    setTimeout(() => router.push({ name: 'login' }), 1600)
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
              {{ t('reset.title') }}
            </v-card-title>
            <v-card-subtitle class="text-wrap">{{ t('reset.subtitle') }}</v-card-subtitle>
          </v-card-item>

          <v-card-text>
            <v-alert
              v-if="!token"
              type="error"
              variant="tonal"
              density="compact"
              class="mb-2"
              :text="t('reset.noToken')"
            />
            <v-alert
              v-else-if="done"
              type="success"
              variant="tonal"
              density="comfortable"
              :text="t('reset.doneText')"
            />
            <template v-else>
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
                  v-model="password"
                  :label="t('reset.newPassword')"
                  :hint="t('auth.passwordHint')"
                  type="password"
                  autocomplete="new-password"
                  prepend-inner-icon="mdi-lock-outline"
                />
                <v-text-field
                  v-model="confirm"
                  :label="t('reset.confirmPassword')"
                  type="password"
                  autocomplete="new-password"
                  prepend-inner-icon="mdi-lock-check-outline"
                  :error="mismatch"
                  :error-messages="mismatch ? t('reset.mismatch') : ''"
                />
                <v-btn
                  type="submit"
                  color="primary"
                  variant="flat"
                  rounded="pill"
                  block
                  class="mt-2"
                  :loading="loading"
                  :disabled="!canSubmit"
                >
                  {{ t('reset.submit') }}
                </v-btn>
              </v-form>
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
