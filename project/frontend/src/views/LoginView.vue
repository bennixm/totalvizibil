<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { ApiError } from '@/services/api'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const email = ref('')
const password = ref('')
const totpCode = ref('')
const needsTotp = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)

async function submit() {
  loading.value = true
  error.value = null
  try {
    await auth.login({
      email: email.value,
      password: password.value,
      totpCode: needsTotp.value ? totpCode.value : undefined,
    })
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : null
    router.push(redirect || { name: 'account' })
  } catch (err) {
    if (err instanceof ApiError && (err.message === 'totp_required' || err.message === 'totp_invalid')) {
      needsTotp.value = true
      error.value = err.message === 'totp_invalid' ? t('auth.totpInvalid') : null
      await nextTick()
      document.getElementById('totp-input')?.focus()
    } else if (err instanceof ApiError && err.message === 'account_suspended') {
      error.value = t('auth.accountSuspended')
    } else {
      error.value = err instanceof ApiError ? err.message : t('auth.genericError')
    }
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
              {{ t('auth.loginTitle') }}
            </v-card-title>
            <v-card-subtitle class="text-wrap">
              {{ needsTotp ? t('auth.totpSubtitle') : t('auth.loginSubtitle') }}
            </v-card-subtitle>
          </v-card-item>
          <v-card-text>
            <v-alert
              v-if="error"
              type="error"
              variant="tonal"
              density="compact"
              class="mb-4"
              :text="error"
            />
            <v-form @submit.prevent="submit">
              <template v-if="!needsTotp">
                <v-text-field
                  v-model="email"
                  :label="t('auth.email')"
                  type="email"
                  autocomplete="email"
                  prepend-inner-icon="mdi-email-outline"
                  required
                />
                <v-text-field
                  v-model="password"
                  :label="t('auth.password')"
                  type="password"
                  autocomplete="current-password"
                  prepend-inner-icon="mdi-lock-outline"
                  required
                />
                <div class="d-flex justify-end mb-1">
                  <v-btn
                    :to="{ name: 'forgot-password' }"
                    variant="text"
                    size="small"
                    class="text-none"
                  >
                    {{ t('auth.forgotPassword') }}
                  </v-btn>
                </div>
              </template>

              <template v-else>
                <p class="text-body-2 text-medium-emphasis mb-3">{{ t('auth.totpHint') }}</p>
                <v-text-field
                  id="totp-input"
                  v-model="totpCode"
                  :label="t('auth.totpCode')"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  maxlength="6"
                  prepend-inner-icon="mdi-shield-key-outline"
                  required
                />
              </template>

              <v-btn
                type="submit"
                color="primary"
                variant="flat"
                rounded="pill"
                block
                class="mt-2"
                :loading="loading"
              >
                {{ needsTotp ? t('auth.totpVerify') : t('auth.submitLogin') }}
              </v-btn>
            </v-form>
          </v-card-text>
          <v-card-actions>
            <span class="text-body-2 text-medium-emphasis ms-2">{{ t('auth.noAccount') }}</span>
            <v-btn :to="{ name: 'create' }" variant="text" size="small">
              {{ t('nav.createBusiness') }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>
