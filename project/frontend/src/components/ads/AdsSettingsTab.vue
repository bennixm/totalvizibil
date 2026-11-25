<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { ApiError } from '@/services/api'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import {
  googleAdsUserApi,
  type AgentSettings,
  type Schedule,
  type UserCampaignDetail,
} from '@/services/googleAdsUser'

/**
 * The owner's control over the agent. Every switch maps onto an existing
 * capability of the platform optimizer; budget changes are never a switch,
 * they are always proposals to approve.
 */
const props = defineProps<{ detail: UserCampaignDetail }>()
const emit = defineEmits<{ (e: 'changed'): void; (e: 'removed'): void }>()
const { t } = useI18n()
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
    await googleAdsUserApi.saveSettings(id.value, { ...form })
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
    if (props.detail.campaign.status === 'paused') await googleAdsUserApi.resume(id.value)
    else await googleAdsUserApi.pause(id.value)
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
      toasts.error(e instanceof ApiError && e.message === 'cycle_running' ? t('ads.set.removeRunning') : t('ads.set.error'))
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
      <v-text-field v-model="form.businessName" :label="t('ads.set.businessName')" :hint="t('ads.set.businessNameHint')" persistent-hint maxlength="25" counter />
      <v-textarea
        v-model="form.businessDescription"
        :label="t('ads.set.businessDescription')"
        :hint="t('ads.set.businessDescriptionHint')"
        persistent-hint
        variant="outlined"
        rounded="lg"
        density="comfortable"
        rows="2"
        auto-grow
        maxlength="300"
        counter
      />
    </section>

    <section class="se__group" data-guide="ads-settings">
      <h3 class="se__h"><v-icon icon="mdi-robot-outline" size="18" /> {{ t('ads.set.agentTitle') }}</h3>
      <div v-for="k in SWITCHES" :key="k" class="se__switch">
        <div>
          <p class="se__label">{{ t(`ads.set.${k}`) }}</p>
          <p class="se__hint">{{ t(`ads.set.${k}Hint`) }}</p>
        </div>
        <v-switch v-model="form[k]" color="primary" hide-details inset density="compact" :aria-label="t(`ads.set.${k}`)" />
      </div>
      <v-text-field
        v-if="form.images"
        v-model="form.imageQuery"
        :label="t('ads.set.imageQuery')"
        :hint="t('ads.set.imageQueryHint')"
        persistent-hint
        maxlength="80"
      />
      <p class="ab-note"><v-icon icon="mdi-shield-check-outline" size="18" /> {{ t('ads.set.budgetRule') }}</p>
    </section>

    <section class="se__group">
      <h3 class="se__h"><v-icon icon="mdi-calendar-clock" size="18" /> {{ t('ads.set.scheduleTitle') }}</h3>
      <div class="se__grid">
        <v-select v-model="form.schedule" :items="scheduleItems" :label="t('ads.set.scheduleLabel')" />
        <v-text-field
          v-if="form.schedule !== 'manual'"
          v-model.number="form.maxCreditsPerCycle"
          type="number"
          :min="detail.pricing.minCredits"
          :label="t('ads.set.maxCredits')"
          :hint="t('ads.set.maxCreditsHint', { min: detail.pricing.minCredits })"
          persistent-hint
        />
      </div>
      <p v-if="form.schedule !== 'manual'" class="ab-note ab-note--warn">
        <v-icon icon="mdi-credit-card-clock-outline" size="18" /> {{ t('ads.set.scheduleBilled') }}
      </p>
    </section>

    <details class="se__group se__adv">
      <summary>{{ t('ads.set.advanced') }}</summary>
      <div v-for="k in ADVANCED_SWITCHES" :key="k" class="se__switch">
        <div>
          <p class="se__label">{{ t(`ads.set.${k}`) }}</p>
          <p class="se__hint">{{ t(`ads.set.${k}Hint`) }}</p>
        </div>
        <v-switch v-model="form[k]" color="primary" hide-details inset density="compact" :aria-label="t(`ads.set.${k}`)" />
      </div>
      <div class="se__grid">
        <v-text-field
          v-model.number="form.chatDailyLimitCredits"
          type="number"
          min="0"
          step="1"
          :label="t('ads.set.chatLimit')"
          :hint="t('ads.set.chatLimitHint')"
          persistent-hint
        />
        <v-text-field
          v-model.number="form.creativeCooldownDays"
          type="number"
          min="1"
          max="60"
          :label="t('ads.set.cooldown')"
          :hint="t('ads.set.cooldownHint')"
          persistent-hint
        />
      </div>
    </details>

    <div class="se__save">
      <v-btn type="submit" color="primary" :loading="saving" :disabled="!dirty" prepend-icon="mdi-content-save-outline">
        {{ t('common.save') }}
      </v-btn>
    </div>

    <section class="se__group se__danger">
      <h3 class="se__h"><v-icon icon="mdi-tune-variant" size="18" /> {{ t('ads.set.manageTitle') }}</h3>
      <div class="se__row">
        <div>
          <p class="se__label">{{ detail.campaign.status === 'paused' ? t('ads.set.resume') : t('ads.set.pause') }}</p>
          <p class="se__hint">{{ t('ads.set.pauseHint') }}</p>
        </div>
        <v-btn variant="tonal" :disabled="detail.campaign.status === 'disconnected'" @click="togglePause">
          {{ detail.campaign.status === 'paused' ? t('ads.set.resume') : t('ads.set.pause') }}
        </v-btn>
      </div>
      <div v-if="detail.campaign.status !== 'disconnected'" class="se__row">
        <div>
          <p class="se__label">{{ t('ads.set.disconnect') }}</p>
          <p class="se__hint">
            {{ t('ads.set.disconnectHint', { email: detail.connection?.googleEmail ?? '' }) }}
          </p>
        </div>
        <v-btn variant="tonal" prepend-icon="mdi-link-variant-off" @click="disconnect">
          {{ t('ads.set.disconnect') }}
        </v-btn>
      </div>
      <div class="se__row">
        <div>
          <p class="se__label">{{ t('ads.set.remove') }}</p>
          <p class="se__hint">{{ t('ads.set.removeHint') }}</p>
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
.se__adv {
  display: block;
}
.se__adv summary {
  cursor: pointer;
  font-weight: 600;
  font-size: var(--tvz-fs-small);
}
.se__adv[open] summary {
  margin-bottom: 0.85rem;
}
.se__adv .se__grid {
  margin-top: 0.85rem;
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
.se__hint {
  margin: 0.15rem 0 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
  overflow-wrap: anywhere;
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
