<script setup lang="ts">
/**
 * Admin › Influenceri › one influencer: change the code, the percentages,
 * the status and the note (admin only), re-send the invite, and the same
 * statistics block the influencer sees in their own panel.
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import AdminDetailHeader from '@/components/admin/AdminDetailHeader.vue'
import AdminSection from '@/components/admin/AdminSection.vue'
import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import InfluencerStats from '@/components/influencer/InfluencerStats.vue'
import { ApiError } from '@/services/api'
import {
  adminGetInfluencer,
  adminResendInfluencerInvite,
  adminUpdateInfluencer,
  type AdminInfluencerDetail,
} from '@/services/influencers'
import { useAuthStore } from '@/stores/auth'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const route = useRoute()
const auth = useAuthStore()
const toasts = useToastStore()
const confirmDialog = useConfirmStore()
const canManage = computed(() => auth.user?.platformRoles.includes('admin') ?? false)

const id = computed(() => String(route.params.id))
const data = ref<AdminInfluencerDetail | null>(null)
const loading = ref(true)
const failed = ref(false)
const saving = ref(false)
const form = reactive({ code: '', discountPct: 0, commissionPct: 0, note: '' })

function hydrate(d: AdminInfluencerDetail): void {
  data.value = d
  Object.assign(form, {
    code: d.influencer.code,
    discountPct: d.influencer.discountPct,
    commissionPct: d.influencer.commissionPct,
    note: d.influencer.note ?? '',
  })
}
async function load(): Promise<void> {
  loading.value = true
  failed.value = false
  try {
    hydrate(await adminGetInfluencer(id.value))
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}
onMounted(load)

const dirty = computed(() => {
  const i = data.value?.influencer
  return (
    !!i &&
    (form.code.trim().toUpperCase() !== i.code ||
      form.discountPct !== i.discountPct ||
      form.commissionPct !== i.commissionPct ||
      form.note.trim() !== (i.note ?? ''))
  )
})
const valid = computed(
  () =>
    /^[A-Z0-9-]{3,24}$/.test(form.code.trim().toUpperCase()) &&
    [form.discountPct, form.commissionPct].every((v) => Number.isInteger(v) && v >= 0 && v <= 90),
)

const ERRORS: Record<string, string> = {
  influencer_code_taken: 'adminInfl.errCodeTaken',
  influencer_code_invalid: 'adminInfl.errCodeInvalid',
  influencer_pct_invalid: 'adminInfl.errPct',
}
function errText(e: unknown): string {
  if (e instanceof ApiError && ERRORS[e.message]) return t(ERRORS[e.message])
  return e instanceof Error ? e.message : t('admin.genericError')
}

async function save(): Promise<void> {
  const i = data.value?.influencer
  if (!i || !valid.value) return
  const go = async () => {
    saving.value = true
    try {
      hydrate(
        await adminUpdateInfluencer(i.id, {
          code: form.code.trim().toUpperCase(),
          discountPct: form.discountPct,
          commissionPct: form.commissionPct,
          note: form.note.trim(),
        }),
      )
      toasts.success(t('adminInfl.saved'))
    } catch (e) {
      toasts.error(errText(e))
    } finally {
      saving.value = false
    }
  }
  // A new code breaks every link/post the influencer already shared.
  if (form.code.trim().toUpperCase() !== i.code) {
    confirmDialog.ask(t('adminInfl.codeChangeTitle'), t('adminInfl.codeChangeText', { old: i.code }), go)
  } else {
    await go()
  }
}

async function toggleActive(): Promise<void> {
  const i = data.value?.influencer
  if (!i) return
  saving.value = true
  try {
    hydrate(await adminUpdateInfluencer(i.id, { active: !i.active }))
    toasts.success(i.active ? t('adminInfl.deactivated') : t('adminInfl.activated'))
  } catch (e) {
    toasts.error(errText(e))
  } finally {
    saving.value = false
  }
}

async function resendInvite(): Promise<void> {
  const i = data.value?.influencer
  if (!i) return
  try {
    await adminResendInfluencerInvite(i.id)
    toasts.success(t('adminInfl.inviteSent'))
  } catch (e) {
    toasts.error(errText(e))
  }
}
</script>

<template>
  <div class="aid">
    <div v-if="loading" class="aid__center"><v-progress-circular indeterminate color="primary" /></div>
    <AdminEmptyState v-else-if="failed || !data" icon="mdi-alert-circle-outline" :text="t('adminInfl.loadError')" />

    <template v-else>
      <AdminDetailHeader
        :back-to="{ name: 'admin-influencers' }"
        :back-label="t('adminInfl.back')"
        :avatar="data.influencer.user.name.slice(0, 2).toUpperCase()"
        :title="data.influencer.user.name"
        :subtitle="data.influencer.user.email"
        :id="data.influencer.id"
      >
        <template #pills>
          <v-chip size="small" variant="tonal" color="primary" prepend-icon="mdi-ticket-percent-outline">
            {{ data.influencer.code }}
          </v-chip>
          <v-chip size="small" variant="tonal" :color="data.influencer.active ? 'success' : 'warning'">
            {{ data.influencer.active ? t('influencer.active') : t('influencer.inactive') }}
          </v-chip>
        </template>
        <template v-if="canManage" #actions>
          <v-btn size="small" variant="tonal" rounded="pill" prepend-icon="mdi-email-fast-outline" @click="resendInvite">
            {{ t('adminInfl.resendInvite') }}
          </v-btn>
          <v-btn
            size="small"
            rounded="pill"
            :variant="data.influencer.active ? 'tonal' : 'flat'"
            :color="data.influencer.active ? 'warning' : 'success'"
            :loading="saving"
            @click="toggleActive"
          >
            {{ data.influencer.active ? t('adminInfl.deactivate') : t('adminInfl.activate') }}
          </v-btn>
        </template>
      </AdminDetailHeader>

      <AdminSection :title="t('adminInfl.settingsTitle')" icon="mdi-ticket-percent-outline" :hint="t('adminInfl.settingsHint')">
        <div class="aid__form">
          <v-text-field
            v-model="form.code"
            :label="t('adminInfl.fCode')"
            :disabled="!canManage"
            class="aid__code"
            @update:model-value="form.code = String($event ?? '').toUpperCase()"
          />
          <v-text-field v-model.number="form.discountPct" :label="t('adminInfl.fDiscount')" type="number" suffix="%" :min="0" :max="90" :disabled="!canManage" />
          <v-text-field v-model.number="form.commissionPct" :label="t('adminInfl.fCommission')" type="number" suffix="%" :min="0" :max="90" :disabled="!canManage" />
          <v-textarea v-model="form.note" :label="t('adminInfl.fNote')" rows="1" auto-grow variant="outlined" rounded="lg" :disabled="!canManage" class="aid__note" />
        </div>
        <p class="aid__help">{{ t('adminInfl.changeEffect') }}</p>
        <div v-if="canManage" class="aid__actions">
          <v-btn color="primary" :loading="saving" :disabled="!dirty || !valid" prepend-icon="mdi-content-save-outline" @click="save">
            {{ t('common.save') }}
          </v-btn>
        </div>
      </AdminSection>

      <InfluencerStats :stats="data" admin-links />
    </template>
  </div>
</template>

<style scoped>
.aid__center {
  display: grid;
  place-items: center;
  min-height: 220px;
}
.aid__form {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr) minmax(0, 0.8fr);
  gap: 0.75rem;
}
.aid__note {
  grid-column: 1 / -1;
}
.aid__code :deep(input) {
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.aid__help {
  margin: 0.4rem 0 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.aid__actions {
  margin-top: 0.8rem;
}
.aid :deep(.asec) {
  margin-bottom: 1.2rem;
}
@media (max-width: 760px) {
  .aid__form {
    grid-template-columns: 1fr;
  }
}
</style>
