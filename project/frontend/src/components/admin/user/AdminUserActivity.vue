<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import AdminSection from '@/components/admin/AdminSection.vue'
import { fetchUserActivity, type UserActivityItem } from '@/services/adminUserAds'
import { ApiError } from '@/services/api'

/** What happened around one user, newest first (money has its own list). */
const props = defineProps<{ userId: string }>()
const { t, te, locale } = useI18n()

const items = ref<UserActivityItem[]>([])
const next = ref<string | null>(null)
const loading = ref(false)
const error = ref('')

async function load(more = false): Promise<void> {
  if (loading.value) return
  loading.value = true
  const forUser = props.userId
  try {
    const res = await fetchUserActivity(forUser, more ? next.value : null)
    if (forUser !== props.userId) return
    items.value = more ? [...items.value, ...res.items] : res.items
    next.value = res.next
    error.value = ''
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('admin.genericError')
  } finally {
    loading.value = false
  }
}
onMounted(() => load())
watch(
  () => props.userId,
  () => {
    items.value = []
    loading.value = false
    void load()
  },
)

const ICON: Record<UserActivityItem['source'], string> = {
  owner: 'mdi-domain',
  staff: 'mdi-shield-account-outline',
  google_ads: 'mdi-google-ads',
  google_ads_cycle: 'mdi-robot-outline',
  session: 'mdi-login-variant',
  ticket: 'mdi-lifebuoy',
}

/** Known codes in words; an unknown one is shown as it is stored. */
function label(i: UserActivityItem): string {
  if (i.source === 'google_ads') {
    const key = `ads.action.${i.action}`
    return te(key) ? t(key) : i.action
  }
  if (i.source === 'google_ads_cycle') return t('admin.activity.cycle')
  if (i.source === 'session') return t('admin.activity.session')
  if (i.source === 'ticket') return t('admin.activity.ticket')
  const key = `admin.activity.code.${i.action.replace(/\./g, '_')}`
  return te(key) ? t(key) : i.action
}
function status(i: UserActivityItem): string {
  if (!i.status) return ''
  const key = i.source === 'google_ads' ? `ads.actionStatus.${i.status}` : i.source === 'google_ads_cycle' ? `ads.cycle.${i.status}` : ''
  return key && te(key) ? t(key) : i.source === 'ticket' ? '' : i.status
}
const when = (s: string) => new Date(s).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'short' })
</script>

<template>
  <AdminSection :title="t('admin.activity.title')" icon="mdi-history">
    <div v-if="loading && !items.length" class="ua__center"><v-progress-circular indeterminate color="primary" /></div>
    <AdminEmptyState v-else-if="error && !items.length" icon="mdi-alert-circle-outline" :text="error" />
    <AdminEmptyState v-else-if="!items.length" icon="mdi-history" :text="t('admin.activity.none')" />
    <template v-else>
      <ul class="ua">
        <li v-for="i in items" :key="`${i.source}${i.id}`" class="ua__row">
          <span class="ua__ic"><v-icon :icon="ICON[i.source]" size="17" /></span>
          <div class="ua__body">
            <b>{{ label(i) }}</b>
            <span v-if="status(i)" class="ua__muted"> · {{ status(i) }}</span>
            <p v-if="i.subject" class="ua__muted">{{ i.subject }}</p>
            <p v-if="i.actor" class="ua__muted">{{ t('admin.activity.by', { name: i.actor }) }}<template v-if="i.reason">: {{ i.reason }}</template></p>
          </div>
          <time class="ua__when" :datetime="i.createdAt">{{ when(i.createdAt) }}</time>
        </li>
      </ul>
      <p v-if="error" class="ua__muted">{{ error }}</p>
      <v-btn v-if="next" class="ua__more" variant="tonal" size="small" rounded="pill" :loading="loading" @click="load(true)">
        {{ t('wallet.loadMore') }}
      </v-btn>
    </template>
  </AdminSection>
</template>

<style scoped>
.ua__center {
  display: grid;
  place-items: center;
  min-height: 140px;
}
.ua {
  list-style: none;
  margin: 0;
  padding: 0;
}
.ua__row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.75rem;
  padding: 0.65rem 0;
  border-top: 1px solid var(--tvz-hairline);
}
.ua__row:first-child {
  border-top: 0;
}
.ua__ic {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
}
.ua__body {
  flex: 1 1 12rem;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: var(--tvz-fs-body);
}
.ua__body p {
  margin: 0.1rem 0 0;
}
.ua__muted,
.ua__when {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.ua__when {
  flex: none;
  font-variant-numeric: tabular-nums;
}
.ua__more {
  margin-top: 0.8rem;
}
</style>
