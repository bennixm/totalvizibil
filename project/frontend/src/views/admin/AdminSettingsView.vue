<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminSection from '@/components/admin/AdminSection.vue'
import { useAdminStore } from '@/stores/admin'
import { ApiError } from '@/services/api'

const { t } = useI18n()
const admin = useAdminStore()

const loading = ref(true)
const saving = ref(false)
const toast = reactive({ show: false, text: '', color: 'success' })
function flash(text: string, color: 'success' | 'error' = 'success') {
  Object.assign(toast, { show: true, text, color })
}

const form = reactive({
  eurRonRate: 0,
  advancedBuilderPriceCredits: 0,
  additionalBusinessPriceCredits: 0,
})

const fields = [
  {
    key: 'eurRonRate' as const,
    label: 'adminSettings.eurRonRate',
    hint: 'adminSettings.eurRonRateHint',
    icon: 'mdi-currency-eur',
    min: 1,
    max: 50,
    step: 0.01,
    suffix: 'RON',
  },
  {
    key: 'advancedBuilderPriceCredits' as const,
    label: 'adminSettings.advancedPrice',
    hint: 'adminSettings.advancedPriceHint',
    icon: 'mdi-hammer-wrench',
    min: 1,
    max: 100000,
    step: 1,
    suffix: 'cr',
  },
  {
    key: 'additionalBusinessPriceCredits' as const,
    label: 'adminSettings.extraBizPrice',
    hint: 'adminSettings.extraBizPriceHint',
    icon: 'mdi-domain-plus',
    min: 1,
    max: 100000,
    step: 1,
    suffix: 'cr',
  },
]

function hydrate() {
  if (!admin.settings) return
  form.eurRonRate = admin.settings.eurRonRate
  form.advancedBuilderPriceCredits = admin.settings.advancedBuilderPriceCredits
  form.additionalBusinessPriceCredits = admin.settings.additionalBusinessPriceCredits
}

const dirty = computed(
  () =>
    !!admin.settings &&
    (form.eurRonRate !== admin.settings.eurRonRate ||
      form.advancedBuilderPriceCredits !== admin.settings.advancedBuilderPriceCredits ||
      form.additionalBusinessPriceCredits !== admin.settings.additionalBusinessPriceCredits),
)
const valid = computed(() =>
  fields.every((f) => {
    const v = form[f.key]
    return typeof v === 'number' && Number.isFinite(v) && v >= f.min && v <= f.max
  }),
)

async function load() {
  loading.value = true
  try {
    await admin.fetchSettings()
    hydrate()
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function save() {
  if (!dirty.value || !valid.value) return
  saving.value = true
  try {
    await admin.updateSettings({ ...form })
    hydrate()
    flash(t('adminSettings.saved'))
  } catch (e) {
    flash(e instanceof ApiError ? e.message : t('admin.genericError'), 'error')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="as">
    <AdminPageHeader
      :title="t('admin.navSettings')"
      :eyebrow="t('admin.navGroupConfig')"
      :sub="t('adminSettings.lead')"
    />

    <div v-if="loading" class="d-flex justify-center py-16">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <AdminSection v-else :title="t('adminSettings.pricingTitle')" icon="mdi-cash-multiple">
      <div class="as__fields">
        <div v-for="f in fields" :key="f.key" class="as__field">
          <span class="as__ic"><v-icon :icon="f.icon" size="18" /></span>
          <div class="as__body">
            <label :for="f.key" class="as__label">{{ t(f.label) }}</label>
            <p class="as__hint">{{ t(f.hint) }}</p>
          </div>
          <v-text-field
            :id="f.key"
            v-model.number="form[f.key]"
            type="number"
            :min="f.min"
            :max="f.max"
            :step="f.step"
            :suffix="f.suffix"
            variant="outlined"
            density="compact"
            hide-details
            class="as__input"
          />
        </div>
      </div>

      <div class="as__foot">
        <span v-if="dirty" class="as__dirty">{{ t('adminSettings.unsaved') }}</span>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!dirty || !valid"
          :loading="saving"
          prepend-icon="mdi-content-save-outline"
          @click="save"
        >
          {{ t('common.save') }}
        </v-btn>
      </div>
    </AdminSection>

    <v-snackbar v-model="toast.show" :color="toast.color" timeout="2600">{{ toast.text }}</v-snackbar>
  </div>
</template>

<style scoped>
.as__fields {
  display: flex;
  flex-direction: column;
}
.as__field {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 1rem 0;
  border-bottom: 1px solid var(--tvz-hairline);
}
.as__field:first-child {
  padding-top: 0;
}
.as__ic {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  flex: none;
  background: rgb(var(--v-theme-primary) / 0.1);
  color: rgb(var(--v-theme-primary));
}
.as__body {
  flex: 1;
  min-width: 0;
}
.as__label {
  font-weight: 600;
  font-size: 0.9rem;
}
.as__hint {
  margin: 0.15rem 0 0;
  font-size: 0.78rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.as__input {
  flex: none;
  width: 150px;
}
.as__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 1rem;
  margin-top: 1.2rem;
}
.as__dirty {
  font-size: 0.8rem;
  color: rgb(var(--v-theme-warning));
}
</style>
