<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { useDraftStore } from '@/stores/draft'

const { t } = useI18n()
const router = useRouter()
const draft = useDraftStore()

const modes = [
  {
    key: 'easy',
    to: 'create-easy',
    icon: 'mdi-flash-outline',
    accent: 'primary',
  },
  {
    key: 'advanced',
    to: 'create-advanced',
    icon: 'mdi-tune-vertical',
    accent: 'secondary',
  },
] as const
</script>

<template>
  <v-container class="cb">
    <div class="cb__head">
      <p class="cb__eyebrow">
        <span class="cb__dot" /> {{ t('create.assistant') }}
      </p>
      <h1>{{ t('create.headline') }}</h1>
      <p class="cb__lead">{{ t('create.lead') }}</p>
    </div>

    <v-alert
      v-if="draft.hasDraft"
      variant="tonal"
      color="primary"
      class="cb__resume"
      icon="mdi-history"
    >
      <div class="d-flex align-center justify-space-between flex-wrap ga-3">
        <span>{{ t('create.resumeText') }}</span>
        <div class="d-flex ga-2">
          <v-btn size="small" variant="text" @click="draft.clear()">{{ t('create.startOver') }}</v-btn>
          <v-btn
            size="small"
            color="primary"
            variant="flat"
            @click="router.push({ name: 'create-preview' })"
          >
            {{ t('create.resume') }}
          </v-btn>
        </div>
      </div>
    </v-alert>

    <div class="cb__modes">
      <button
        v-for="m in modes"
        :key="m.key"
        class="mode"
        :class="`mode--${m.accent}`"
        @click="router.push({ name: m.to })"
      >
        <v-icon :icon="m.icon" size="26" />
        <h2>{{ t(`create.${m.key}Title`) }}</h2>
        <p>{{ t(`create.${m.key}Text`) }}</p>
        <span class="mode__go">
          {{ t(`create.${m.key}Cta`) }} <v-icon icon="mdi-arrow-right" size="16" />
        </span>
      </button>
    </div>

    <p class="cb__foot">{{ t('create.registerLaterNote') }}</p>
  </v-container>
</template>

<style scoped>
.cb {
  max-width: 860px;
  padding-block: clamp(2.5rem, 7vw, 5rem);
}
.cb__head {
  text-align: center;
  margin-bottom: 2.5rem;
}
.cb__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 11px;
  font-weight: 600;
  color: var(--tvz-ai);
  margin: 0 0 1rem;
}
.cb__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--tvz-ai);
  box-shadow: 0 0 0 4px var(--tvz-ai-soft);
}
.cb__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(2rem, 5.5vw, 3.2rem);
  letter-spacing: -0.03em;
  line-height: 1.05;
  margin: 0;
  text-wrap: balance;
}
.cb__lead {
  margin: 1rem auto 0;
  max-width: 46ch;
  color: rgb(var(--v-theme-on-surface) / 0.66);
  font-size: 1.05rem;
}
.cb__resume {
  margin-bottom: 1.5rem;
}
.cb__modes {
  display: grid;
  gap: 1.2rem;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}
.mode {
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1.8rem;
  border-radius: var(--tvz-radius-lg);
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  cursor: pointer;
  box-shadow: var(--tvz-shadow-sm);
  transition:
    transform var(--tvz-dur-med) var(--tvz-ease-out),
    box-shadow var(--tvz-dur-med) var(--tvz-ease-out),
    border-color var(--tvz-dur-med) var(--tvz-ease-out);
}
.mode:hover {
  transform: translateY(-4px);
  box-shadow: var(--tvz-shadow-lg);
}
.mode--primary:hover {
  border-color: rgba(var(--v-theme-primary), 0.5);
}
.mode--secondary:hover {
  border-color: rgba(var(--v-theme-secondary), 0.5);
}
.mode .v-icon {
  color: rgb(var(--v-theme-primary));
}
.mode--secondary .v-icon {
  color: rgb(var(--v-theme-secondary));
}
.mode h2 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.2rem;
  font-weight: 600;
  margin: 0.4rem 0 0;
}
.mode p {
  color: rgb(var(--v-theme-on-surface) / 0.66);
  font-size: 0.92rem;
  margin: 0;
  flex: 1;
}
.mode__go {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-weight: 600;
  font-size: 0.88rem;
  color: rgb(var(--v-theme-primary));
  margin-top: 0.6rem;
}
.mode--secondary .mode__go {
  color: rgb(var(--v-theme-secondary));
}
.cb__foot {
  text-align: center;
  margin-top: 2rem;
  font-size: 0.82rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
</style>
