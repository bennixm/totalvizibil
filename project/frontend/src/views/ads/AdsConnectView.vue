<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AdsBuilderShell from '@/components/ads/AdsBuilderShell.vue'
import { useSeo } from '@/composables/useSeo'
import { useToastStore } from '@/stores/toast'
import { googleAdsUserApi, saveDraftToken, type ConnectionView } from '@/services/googleAdsUser'

/**
 * Step 1: connect the visitor's Google Ads account through Google's own
 * consent screen (OAuth). Free. Google sends the browser back to the
 * backend, which then redirects to the campaigns step.
 */
const { t } = useI18n()
const router = useRouter()
const toasts = useToastStore()
useSeo(() => ({ title: t('ads.connect.seoTitle'), description: t('ads.connect.lead'), canonicalPath: '/google-ads' }))

const ready = ref(false)
const available = ref(true)
const minCredits = ref(10)
const connection = ref<ConnectionView | null>(null)
const busy = ref(false)

const ACCESS = ['read', 'apply', 'budget', 'revoke'] as const

async function connect(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const { url } = await googleAdsUserApi.connectUrl()
    window.location.href = url
  } catch {
    busy.value = false
    toasts.error(t('ads.connect.error'))
  }
}

onMounted(async () => {
  try {
    const status = await googleAdsUserApi.status()
    available.value = status.available
    minCredits.value = status.minCredits
    const res = await googleAdsUserApi.start()
    saveDraftToken(res.draftToken)
    connection.value = res.connection
    if (res.connection.status === 'connected') {
      void router.replace({ name: 'ads-campaigns' })
      return
    }
  } catch {
    toasts.error(t('ads.connect.error'))
  }
  ready.value = true
})
</script>

<template>
  <AdsBuilderShell current="connect" :title="t('ads.connect.title')" :lead="t('ads.connect.lead')">
    <div v-if="!ready" class="ab-center"><v-progress-circular indeterminate color="primary" /></div>

    <div v-else class="ab-card">
      <p v-if="!available" class="ab-note ab-note--warn">
        <v-icon icon="mdi-wrench-clock" size="18" /> {{ t('ads.connect.unavailable') }}
      </p>

      <p class="ac__label">{{ t('ads.connect.accessTitle') }}</p>
      <ul class="ab-list">
        <li v-for="k in ACCESS" :key="k">
          <v-icon icon="mdi-check-circle-outline" size="18" /> {{ t(`ads.connect.access.${k}`) }}
        </li>
      </ul>

      <p v-if="connection?.status === 'revoked' || connection?.status === 'error'" class="ab-note ab-note--warn">
        <v-icon icon="mdi-alert-circle-outline" size="18" /> {{ t('ads.connect.retry') }}
      </p>

      <v-btn
        color="primary"
        size="large"
        block
        :loading="busy"
        :disabled="!available"
        prepend-icon="mdi-google"
        data-guide="ads-connect"
        @click="connect"
      >
        {{ t('ads.connect.cta') }}
      </v-btn>

      <p class="ab-note" data-guide="ads-free">
        <v-icon icon="mdi-gift-outline" size="18" />
        {{ t('ads.connect.free', { credits: minCredits }) }}
      </p>
      <p class="ac__secure">
        <v-icon icon="mdi-shield-lock-outline" size="15" /> {{ t('ads.connect.secure') }}
      </p>
    </div>

    <div class="ab-back">
      <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" :to="{ name: 'start' }">
        {{ t('ads.back') }}
      </v-btn>
    </div>
  </AdsBuilderShell>
</template>

<style scoped>
.ac__label {
  margin: 0;
  font-weight: 600;
}
.ac__secure {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  margin: 0;
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.ac__secure .v-icon {
  margin-top: 0.1rem;
  flex: none;
}
</style>
