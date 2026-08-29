<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { useCompaniesStore } from '@/stores/companies'
import { ApiError } from '@/services/api'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const companies = useCompaniesStore()

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref<string | null>(null)

async function submit() {
  loading.value = true
  error.value = null
  try {
    await auth.login({ email: email.value, password: password.value })
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : null
    if (redirect) {
      router.push(redirect)
      return
    }
    await companies.fetchList()
    router.push({ name: companies.hasCompany ? 'dashboard' : 'company-create' })
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
              {{ t('auth.loginTitle') }}
            </v-card-title>
            <v-card-subtitle class="text-wrap">{{ t('auth.loginSubtitle') }}</v-card-subtitle>
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
              <v-text-field
                v-model="email"
                :label="t('auth.email')"
                type="email"
                autocomplete="email"
                required
              />
              <v-text-field
                v-model="password"
                :label="t('auth.password')"
                type="password"
                autocomplete="current-password"
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
                {{ t('auth.submitLogin') }}
              </v-btn>
            </v-form>
          </v-card-text>
          <v-card-actions>
            <span class="text-body-2 text-medium-emphasis ms-2">{{ t('auth.noAccount') }}</span>
            <v-btn :to="{ name: 'register' }" variant="text" size="small">
              {{ t('auth.registerTitle') }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>
