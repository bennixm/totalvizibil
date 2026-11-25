<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import GaChip from '@/components/admin/google-ads/GaChip.vue'
import { dateTime } from '@/components/ads/format'
import '@/components/ads/ads.css'
import { ApiError } from '@/services/api'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { useGoogleAdsUserStore } from '@/stores/googleAdsUser'
import { googleAdsUserApi, type GoogleConnection } from '@/services/googleAdsUser'

/**
 * The signed-in owner's connected Google accounts: which Google login, its
 * managed campaigns, and actions (add campaigns from it without signing in
 * to Google again, disconnect, reconnect). Connecting a NEW Google account
 * goes through the builder.
 */
const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const toasts = useToastStore()
const confirm = useConfirmStore()
const adsStore = useGoogleAdsUserStore()

const rows = ref<GoogleConnection[] | null>(null)
const busy = ref<string | null>(null)

async function load(): Promise<void> {
  try {
    rows.value = await googleAdsUserApi.connections()
  } catch {
    rows.value = []
    toasts.error(t('ads.conn.loadError'))
  }
}

function disconnect(c: GoogleConnection): void {
  confirm.ask(t('ads.set.disconnectTitle'), t('ads.conn.disconnectText', { n: c.campaigns.length }), async () => {
    busy.value = c.id
    try {
      await googleAdsUserApi.disconnectConnection(c.id)
      toasts.success(t('ads.set.disconnected'))
      await Promise.all([load(), adsStore.fetch(true)])
    } catch (e) {
      toasts.error(e instanceof ApiError && ['cycle_running', 'chat_running'].includes(e.message) ? t('ads.set.removeRunning') : t('ads.set.error'))
    } finally {
      busy.value = null
    }
  })
}

async function reconnect(c: GoogleConnection): Promise<void> {
  busy.value = c.id
  try {
    const { url } = await googleAdsUserApi.reconnectConnection(c.id)
    window.location.href = url
  } catch {
    busy.value = null
    toasts.error(t('ads.connect.error'))
  }
}

const OAUTH_ERRORS = ['account', 'denied', 'access_denied', 'expired', 'state', 'scope', 'refresh', 'exchange']

const TONE = { connected: 'success', revoked: 'error', error: 'error', pending: 'neutral' } as const

onMounted(() => {
  if (route.query.reconnected) {
    toasts.success(t('ads.dash.reconnected'))
    const taken = Number(route.query.taken)
    if (taken > 0) toasts.warning(t('ads.campaigns.takenReconnect', { n: taken }))
    void router.replace({ query: {} })
  }
  const err = typeof route.query.error === 'string' ? route.query.error : ''
  if (err) {
    toasts.error(t(`ads.campaigns.oauthError.${OAUTH_ERRORS.includes(err) ? err : 'exchange'}`))
    void router.replace({ query: {} })
  }
  void load()
  void adsStore.fetch(true)
})
</script>

<template>
  <v-container class="cn" fluid>
    <AdminPageHeader eyebrow="Google Ads" :title="t('ads.conn.title')" :hint="t('ads.conn.lead')">
      <template #actions>
        <v-btn color="primary" prepend-icon="mdi-google" :to="{ name: 'ads-connect' }">
          {{ t('ads.conn.connectNew') }}
        </v-btn>
      </template>
    </AdminPageHeader>

    <div v-if="!rows" class="ab-center"><v-progress-circular indeterminate color="primary" /></div>
    <div v-else-if="!rows.length" class="ab-card cn__empty">
      <p class="ab-note"><v-icon icon="mdi-google-ads" size="18" /> {{ t('ads.conn.empty') }}</p>
      <v-btn color="primary" :to="{ name: 'ads-connect' }">{{ t('ads.conn.connectNew') }}</v-btn>
    </div>

    <div v-else class="cn__list">
      <article v-for="c in rows" :key="c.id" class="cc">
        <header class="cc__head">
          <span class="cc__icon"><v-icon icon="mdi-google" size="20" /></span>
          <div class="cc__who">
            <b :title="c.googleEmail ?? undefined">{{ c.googleEmail ?? t('ads.campaigns.connectedAccount') }}</b>
            <span>{{ t('ads.conn.since', { when: dateTime(c.connectedAt, locale) }) }}</span>
          </div>
          <GaChip :tone="TONE[c.status]">{{ t(`ads.conn.status.${c.status}`) }}</GaChip>
        </header>

        <div class="cc__campaigns">
          <p class="cc__label">{{ t('ads.conn.campaigns', { n: c.campaigns.length }) }}</p>
          <RouterLink
            v-for="k in c.campaigns"
            :key="k.id"
            :to="{ name: 'ads-dashboard', params: { id: k.id } }"
            class="cc__camp"
          >
            <span class="cc__dot" :class="`t-${k.status}`" />
            <span class="cc__name" :title="k.name">{{ k.name }}</span>
            <span v-if="k.customerName" class="cc__acc">{{ k.customerName }}</span>
            <v-icon icon="mdi-chevron-right" size="16" />
          </RouterLink>
        </div>

        <footer class="cc__actions">
          <v-btn
            v-if="c.status === 'connected'"
            color="primary"
            variant="tonal"
            prepend-icon="mdi-plus"
            :to="{ name: 'ads-connection-add', params: { id: c.id } }"
          >
            {{ t('ads.conn.addCampaigns') }}
          </v-btn>
          <v-btn v-else color="primary" prepend-icon="mdi-link-variant" :loading="busy === c.id" @click="reconnect(c)">
            {{ t('ads.dash.reconnect') }}
          </v-btn>
          <v-btn
            v-if="c.status === 'connected'"
            variant="text"
            prepend-icon="mdi-link-variant-off"
            :loading="busy === c.id"
            @click="disconnect(c)"
          >
            {{ t('ads.set.disconnect') }}
          </v-btn>
        </footer>
      </article>
    </div>
  </v-container>
</template>

<style scoped>
.cn {
  max-width: 1000px;
}
.cn__empty {
  max-width: 560px;
}
.cn__list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
  gap: 1rem;
}
.cc {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 1.1rem 1.2rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
}
.cc__head {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
}
.cc__icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: 11px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.cc__who {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.cc__who b {
  overflow-wrap: anywhere;
}
.cc__who span {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.cc__campaigns {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  flex: 1;
}
.cc__label {
  margin: 0 0 0.2rem;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.cc__camp {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.55rem;
  border-radius: 8px;
  color: inherit;
  text-decoration: none;
  font-size: var(--tvz-fs-small);
}
.cc__camp:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.cc__name {
  flex: 1;
  min-width: 0;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cc__acc {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 600px) {
  .cc__acc {
    display: none;
  }
}
.cc__dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), 0.3);
}
.cc__dot.t-active {
  background: rgb(var(--v-theme-success));
}
.cc__dot.t-disconnected {
  background: rgb(var(--v-theme-error));
}
.cc__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding-top: 0.8rem;
  border-top: 1px solid var(--tvz-hairline);
}
</style>
