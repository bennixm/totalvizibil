<script setup lang="ts">
import PasswordField from '@/components/PasswordField.vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { apiFetch, ApiError } from '@/services/api'
import { useSeo } from '@/composables/useSeo'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

// The same page serves two flows: "reset" (forgot password) and "set"
// (first password of an account created for someone, e.g. a new influencer
// from the welcome email). Only the wording differs.
const isSet = computed(() => route.meta.passwordMode === 'set')
const OVERRIDES = ['title', 'subtitle', 'invalidToken', 'doneText', 'submit', 'newPassword'] as const
function k(key: string): string {
  return isSet.value && (OVERRIDES as readonly string[]).includes(key) ? `setPw.${key}` : `reset.${key}`
}

useSeo(() => ({ title: t(k('title')), noindex: true }))

const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))
const password = ref('')
const confirm = ref('')
const loading = ref(false)
const done = ref(false)
const error = ref<string | null>(null)
const toasts = useToastStore()
watch(error, (v) => {
  if (v) toasts.error(v)
})

// Checked once against the backend before the form ever renders — a link
// that's already expired or been used must never show a live password
// field, only a fail-on-submit error after the user filled it in.
const checkingToken = ref(true)
const tokenValid = ref(false)
onMounted(async () => {
  if (!token.value) {
    checkingToken.value = false
    return
  }
  try {
    const res = await apiFetch<{ valid: boolean }>(
      `/auth/password/reset/validate?token=${encodeURIComponent(token.value)}`,
    )
    tokenValid.value = res.valid
  } catch {
    tokenValid.value = false
  } finally {
    checkingToken.value = false
  }
})

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
    <h1 class="sr-only">{{ t(k('title')) }}</h1>
    <v-row justify="center">
      <v-col cols="12" sm="8" md="5" lg="4">
        <v-card border flat class="pa-4 tvz-card">
          <v-card-item>
            <v-card-title class="text-h5 font-weight-bold font-display">
              {{ t(k('title')) }}
            </v-card-title>
            <v-card-subtitle class="text-wrap">{{ t(k('subtitle')) }}</v-card-subtitle>
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
            <div v-else-if="checkingToken" class="d-flex justify-center py-4">
              <v-progress-circular indeterminate color="primary" />
            </div>
            <v-alert
              v-else-if="!tokenValid && !done"
              type="error"
              variant="tonal"
              density="compact"
              class="mb-2"
              :text="t(k('invalidToken'))"
            />
            <v-alert
              v-else-if="done"
              type="success"
              variant="tonal"
              density="comfortable"
              :text="t(k('doneText'))"
            />
            <template v-else>
              <v-form @submit.prevent="submit">
                <PasswordField
                  v-model="password"
                  :label="t(k('newPassword'))"
                  :hint="t('auth.passwordHint')"
                  autocomplete="new-password"
                  prepend-inner-icon="mdi-lock-outline"
                />
                <PasswordField
                  v-model="confirm"
                  :label="t('reset.confirmPassword')"
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
                  {{ t(k('submit')) }}
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
