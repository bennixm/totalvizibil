<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { apiFetch, ApiError } from '@/services/api'
import { useCompaniesStore, type LocalizedName } from '@/stores/companies'

interface CategoryOption {
  id: string
  slug: string
  name: LocalizedName
  icon?: string | null
}

const { t, locale } = useI18n()
const router = useRouter()
const companies = useCompaniesStore()

const displayName = ref('')
const categoryId = ref<string | null>(null)
const city = ref('')
const region = ref('')
const phone = ref('')
const email = ref('')
const description = ref('')
const services = ref<string[]>([''])

const categories = ref<CategoryOption[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const categoryItems = computed(() =>
  categories.value.map((c) => ({
    value: c.id,
    title: c.name[locale.value as keyof LocalizedName] ?? c.name.en,
  })),
)

onMounted(async () => {
  try {
    const { data } = await apiFetch<{ data: CategoryOption[] }>('/categories')
    categories.value = data
  } catch {
    // Non-fatal: the field just stays empty and category is optional.
  }
})

function addService() {
  services.value.push('')
}
function removeService(index: number) {
  services.value.splice(index, 1)
  if (services.value.length === 0) services.value.push('')
}

async function submit() {
  loading.value = true
  error.value = null
  try {
    const cleanedServices = services.value
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name }))

    const company = await companies.create({
      displayName: displayName.value.trim(),
      description: description.value.trim() || undefined,
      categoryId: categoryId.value ?? undefined,
      phone: phone.value.trim() || undefined,
      email: email.value.trim() || undefined,
      location: city.value.trim()
        ? { city: city.value.trim(), region: region.value.trim() || undefined }
        : undefined,
      services: cleanedServices.length ? cleanedServices : undefined,
    })
    router.push({ name: 'dashboard', query: { company: company.id } })
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t('company.createError')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <v-container class="py-10">
    <div class="page-container" style="max-width: 720px">
      <h1 class="text-h4 font-weight-bold font-display mb-1">{{ t('company.createTitle') }}</h1>
      <p class="text-body-1 text-medium-emphasis mb-6">{{ t('company.createIntro') }}</p>

      <v-alert
        v-if="error"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-4"
        :text="error"
      />

      <v-form @submit.prevent="submit">
        <v-card border flat class="tvz-card pa-4 mb-4">
          <v-text-field
            v-model="displayName"
            :label="t('company.displayName')"
            :hint="t('company.displayNameHint')"
            persistent-hint
            required
            class="mb-2"
          />
          <v-select
            v-model="categoryId"
            :items="categoryItems"
            :label="t('company.category')"
            clearable
          />
          <v-row>
            <v-col cols="12" sm="7">
              <v-text-field v-model="city" :label="t('company.city')" />
            </v-col>
            <v-col cols="12" sm="5">
              <v-text-field v-model="region" :label="t('company.region')" />
            </v-col>
          </v-row>
          <v-row>
            <v-col cols="12" sm="6">
              <v-text-field v-model="phone" :label="t('company.phone')" type="tel" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="email" :label="t('company.email')" type="email" />
            </v-col>
          </v-row>
          <v-textarea
            v-model="description"
            :label="t('company.description')"
            rows="3"
            auto-grow
          />
        </v-card>

        <v-card border flat class="tvz-card pa-4 mb-4">
          <div class="d-flex align-center justify-space-between mb-1">
            <span class="text-subtitle-1 font-weight-bold">{{ t('company.services') }}</span>
            <v-btn variant="text" size="small" prepend-icon="mdi-plus" @click="addService">
              {{ t('company.addService') }}
            </v-btn>
          </div>
          <p class="text-caption text-medium-emphasis mb-3">{{ t('company.servicesHint') }}</p>
          <div v-for="(_, i) in services" :key="i" class="d-flex ga-2 align-start">
            <v-text-field
              v-model="services[i]"
              :label="t('company.serviceName')"
              density="comfortable"
            />
            <v-btn
              icon="mdi-close"
              variant="text"
              size="small"
              class="mt-2"
              :aria-label="t('company.remove')"
              @click="removeService(i)"
            />
          </div>
        </v-card>

        <v-btn
          type="submit"
          color="primary"
          variant="flat"
          rounded="pill"
          size="large"
          :loading="loading"
          :text="loading ? t('company.creating') : t('company.submit')"
        />
      </v-form>
    </div>
  </v-container>
</template>
