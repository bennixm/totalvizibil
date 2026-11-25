<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminHint from '@/components/admin/AdminHint.vue'
import AdminHintText from '@/components/admin/AdminHintText.vue'
import AdsSection from './AdsSection.vue'
import { ApiError } from '@/services/api'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import {
  googleAdsUserApi,
  type AgentSettings,
  type Schedule,
  type UserCampaignDetail,
} from '@/services/googleAdsUser'
import { useAdsApi } from './adsApi'

/**
 * The owner's control over the agent. Every switch maps onto an existing
 * capability of the platform optimizer; budget changes are never a switch,
 * they are always proposals to approve.
 */
const props = defineProps<{ detail: UserCampaignDetail }>()
const emit = defineEmits<{ (e: 'changed'): void; (e: 'removed'): void }>()
const { t } = useI18n()
const { api, staff } = useAdsApi()
const toasts = useToastStore()
const confirm = useConfirmStore()

const form = reactive<AgentSettings>({ ...props.detail.settings })
watch(
  () => props.detail.settings,
  (s) => Object.assign(form, s),
)
const saving = ref(false)
const dirty = computed(() =>
  (Object.keys(form) as (keyof AgentSettings)[]).some((k) => form[k] !== props.detail.settings[k]),
)
const id = computed(() => props.detail.campaign.id)

const SWITCHES = ['autoApply', 'images', 'textRewriteProposals', 'budgetProposals'] as const
const ADVANCED_SWITCHES = ['keywordHeadlines'] as const
const SCHEDULES: Schedule[] = ['manual', 'weekly', 'biweekly', 'monthly']
const scheduleItems = computed(() => SCHEDULES.map((v) => ({ value: v, title: t(`ads.set.schedule.${v}`) })))

async function save(): Promise<void> {
  if (saving.value) return
  saving.value = true
  try {
    await api.saveSettings(id.value, { ...form })
    toasts.success(t('ads.set.saved'))
    emit('changed')
  } catch (e) {
    toasts.error(e instanceof ApiError ? e.message : t('ads.set.error'))
  } finally {
    saving.value = false
  }
}

async function togglePause(): Promise<void> {
  try {
    if (props.detail.campaign.status === 'paused') await api.resume(id.value)
    else await api.pause(id.value)
    emit('changed')
  } catch {
    toasts.error(t('ads.set.error'))
  }
}

function disconnect(): void {
  confirm.ask(t('ads.set.disconnectTitle'), t('ads.set.disconnectText'), async () => {
    try {
      await googleAdsUserApi.disconnect(id.value)
      toasts.success(t('ads.set.disconnected'))
      emit('changed')
    } catch (e) {
      toasts.error(e instanceof ApiError && ['cycle_running', 'chat_running'].includes(e.message) ? t('ads.set.removeRunning') : t('ads.set.error'))
    }
  })
}

function remove(): void {
  confirm.ask(t('ads.set.removeTitle'), t('ads.set.removeText'), async () => {
    try {
      await googleAdsUserApi.remove(id.value)
      toasts.success(t('ads.set.removed'))
      emit('removed')
    } catch (e) {
      toasts.error(e instanceof ApiError && ['cycle_running', 'chat_running'].includes(e.message) ? t('ads.set.removeRunning') : t('ads.set.error'))
    }
  })
}
</script>

<template>
  <form class="se" @submit.prevent="save">
    <section class="se__group">
      <h3 class="se__h"><v-icon icon="mdi-storefront-outline" size="18" /> {{ t('ads.set.businessTitle') }}</h3>
      <v-text-field hide-details="auto" v-model="form.businessName" :label="t('ads.set.businessName')" maxlength="25" counter>
        <template #append-inner><AdminHint :text="t('ads.set.businessNameHint')" /></template>
      </v-text-field>
      <v-textarea hide-details="auto"
        v-model="form.businessDescription"
        :label="t('ads.set.businessDescription')"
        variant="outlined"
        rounded="lg"
        density="comfortable"
        rows="2"
        auto-grow
        maxlength="300"
        counter
      >
        <template #append-inner><AdminHint :text="t('ads.set.businessDescriptionHint')" /></template>
      </v-textarea>
    </section>

    <section class="se__group" data-guide="ads-settings">
      <h3 class="se__h"><v-icon icon="mdi-robot-outline" size="18" /> {{ t('ads.set.agentTitle') }} <AdminHint :text="t('ads.set.budgetRule')" /></h3>
      <div v-for="k in SWITCHES" :key="k" class="se__switch">
        <div>
          <p class="se__label"><AdminHintText :label="t(`ads.set.${k}`)" :hint="t(`ads.set.${k}Hint`)" /></p>
        </div>
        <v-switch v-model="form[k]" color="primary" hide-details inset density="compact" :aria-label="t(`ads.set.${k}`)" />
      </div>
      <v-text-field hide-details="auto"
        v-if="form.images"
        v-model="form.imageQuery"
        :label="t('ads.set.imageQuery')"
        maxlength="80"
      >
        <template #append-inner><AdminHint :text="t('ads.set.imageQueryHint')" /></template>
      </v-text-field>
    </section>

    <section class="se__group">
      <h3 class="se__h"><v-icon icon="mdi-calendar-clock" size="18" /> {{ t('ads.set.scheduleTitle') }} <AdminHint v-if="staff" :text="t('admin.ads.settingsNote')" /></h3>
      <div class="se__grid">
        <v-select v-model="form.schedule" :items="scheduleItems" :label="t('ads.set.scheduleLabel')" />
        <v-text-field hide-details="auto"
          v-if="form.schedule !== 'manual'"
          v-model.number="form.maxCreditsPerCycle"
          type="number"
          :min="detail.pricing.minCredits"
          :label="t('ads.set.maxCredits')"
      >
        <template #append-inner><AdminHint :text="t('ads.set.maxCreditsHint', { min: detail.pricing.minCredits })" /></template>
      </v-text-field>
      </div>
      <p v-if="form.schedule !== 'manual'" class="ab-note ab-note--warn">
        <v-icon icon="mdi-credit-card-clock-outline" size="18" /> {{ t('ads.set.scheduleBilled') }}
      </p>
    </section>

    <AdsSection name="advanced" :title="t('ads.set.advanced')" icon="mdi-cog-outline">
      <div v-for="k in ADVANCED_SWITCHES" :key="k" class="se__switch">
        <div>
          <p class="se__label"><AdminHintText :label="t(`ads.set.${k}`)" :hint="t(`ads.set.${k}Hint`)" /></p>
        </div>
        <v-switch v-model="form[k]" color="primary" hide-details inset density="compact" :aria-label="t(`ads.set.${k}`)" />
      </div>
      <div class="se__grid">
        <v-text-field hide-details="auto"
          v-model.number="form.chatDailyLimitCredits"
          type="number"
          min="0"
          step="1"
          :label="t('ads.set.chatLimit')"
      >
        <template #append-inner><AdminHint :text="t('ads.set.chatLimitHint')" /></template>
      </v-text-field>
        <v-text-field hide-details="auto"
          v-model.number="form.creativeCooldownDays"
          type="number"
          min="1"
          max="60"
          :label="t('ads.set.cooldown')"
      >
        <template #append-inner><AdminHint :text="t('ads.set.cooldownHint')" /></template>
      </v-text-field>
      </div>
    </AdsSection>

    <div class="se__save">
      <v-btn type="submit" color="primary" :loading="saving" :disabled="!dirty" prepend-icon="mdi-content-save-outline">
        {{ t('common.save') }}
      </v-btn>
    </div>

    <section class="se__group se__danger">
      <h3 class="se__h"><v-icon icon="mdi-tune-variant" size="18" /> {{ t('ads.set.manageTitle') }}</h3>
      <div class="se__row">
        <div>
          <p class="se__label"><AdminHintText :label="detail.campaign.status === 'paused' ? t('ads.set.resume') : t('ads.set.pause')" :hint="t('ads.set.pauseHint')" /></p>
        </div>
        <v-btn variant="tonal" :disabled="detail.campaign.status === 'disconnected'" @click="togglePause">
          {{ detail.campaign.status === 'paused' ? t('ads.set.resume') : t('ads.set.pause') }}
        </v-btn>
      </div>
      <div v-if="!staff && detail.campaign.status !== 'disconnected'" class="se__row">
        <div>
          <p class="se__label"><AdminHintText :label="t('ads.set.disconnect')" :hint="t('ads.set.disconnectHint', { email: detail.connection?.googleEmail ?? '' })" /></p>
        </div>
        <v-btn variant="tonal" prepend-icon="mdi-link-variant-off" @click="disconnect">
          {{ t('ads.set.disconnect') }}
        </v-btn>
      </div>
      <div v-if="!staff" class="se__row">
        <div>
          <p class="se__label"><AdminHintText :label="t('ads.set.remove')" :hint="t('ads.set.removeHint')" /></p>
        </div>
        <v-btn variant="tonal" color="error" @click="remove">{{ t('ads.set.remove') }}</v-btn>
      </div>
    </section>
  </form>
</template>

<style scoped>
.se {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 820px;
}
.se__group {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1.15rem 1.25rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
}
.se__h {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  font-size: var(--tvz-fs-body, 1rem);
  font-weight: 600;
}
.se__h .v-icon {
  color: rgb(var(--v-theme-primary));
}
.se__switch,
.se__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--tvz-hairline);
}
.se__switch > div:first-child,
.se__row > div:first-child {
  min-width: 0;
}
.se__row .v-btn {
  flex: none;
  max-width: 100%;
}
.se__switch:first-of-type {
  border-top: 0;
  padding-top: 0;
}
.se__label {
  margin: 0;
  font-weight: 500;
  font-size: var(--tvz-fs-small);
}
.se__switch .v-switch {
  flex: none;
}
.se__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 0.75rem 1rem;
}
.se :deep(.v-messages__message) {
  line-height: 1.35;
}
.se__save {
  display: flex;
  justify-content: flex-end;
}
@media (max-width: 720px) {
  .se__row > div:first-child {
    width: 100%;
  }
  .se__row {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
