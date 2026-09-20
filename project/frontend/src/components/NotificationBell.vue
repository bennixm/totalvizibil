<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import { routeForNotification, useNotificationsStore, type NotificationItem } from '@/stores/notifications'

const { t, locale } = useI18n()
const router = useRouter()
const store = useNotificationsStore()
const { items, unreadCount, nextCursor, loading } = storeToRefs(store)

const menuOpen = ref(false)
const badgeText = computed(() => (unreadCount.value > 9 ? '9+' : String(unreadCount.value)))

const rtf = computed(() => new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' }))
function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.round(diff / 60000)
  if (min < 1) return rtf.value.format(0, 'minute')
  if (min < 60) return rtf.value.format(-min, 'minute')
  const hr = Math.round(min / 60)
  if (hr < 24) return rtf.value.format(-hr, 'hour')
  return rtf.value.format(-Math.round(hr / 24), 'day')
}

async function onOpen(open: boolean): Promise<void> {
  if (open) await store.load(false)
}

function openNotification(n: NotificationItem): void {
  store.markRead(n.id)
  const to = routeForNotification(n)
  if (to) {
    menuOpen.value = false
    void router.push(to)
  }
}
</script>

<template>
  <v-menu
    v-model="menuOpen"
    location="bottom end"
    origin="top end"
    transition="scale-transition"
    :close-on-content-click="false"
    content-class="notifmenu"
    @update:model-value="onOpen"
  >
    <template #activator="{ props }">
      <button v-bind="props" class="bell-btn" :aria-label="t('notifications.bell')">
        <v-icon icon="mdi-bell-outline" size="21" />
        <span v-if="unreadCount > 0" class="bell-btn__badge">{{ badgeText }}</span>
      </button>
    </template>

    <v-card class="notiflist" rounded="0" :elevation="16">
      <header class="notiflist__head">
        <strong>{{ t('notifications.bell') }}</strong>
        <button
          v-if="unreadCount > 0"
          type="button"
          class="notiflist__markall"
          @click="store.markAllRead()"
        >
          {{ t('notifications.markAllRead') }}
        </button>
      </header>

      <div class="notiflist__scroll">
        <p v-if="!loading && !items.length" class="notiflist__empty">
          {{ t('notifications.empty') }}
        </p>
        <button
          v-for="n in items"
          :key="n.id"
          type="button"
          class="notifrow"
          :class="{ 'is-unread': !n.readAt }"
          @click="openNotification(n)"
        >
          <span class="notifrow__dot" />
          <span class="notifrow__body">
            <strong>{{ n.title }}</strong>
            <span class="notifrow__text">{{ n.body }}</span>
            <span class="notifrow__time">{{ ago(n.createdAt) }}</span>
          </span>
        </button>
        <button
          v-if="nextCursor"
          type="button"
          class="notiflist__more"
          :disabled="loading"
          @click="store.load(true)"
        >
          {{ t('notifications.loadMore') }}
        </button>
      </div>
    </v-card>
  </v-menu>
</template>

<style scoped>
.bell-btn {
  position: relative;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  border: 0;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.72);
  cursor: pointer;
  transition: background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.bell-btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.bell-btn__badge {
  position: absolute;
  top: 3px;
  right: 3px;
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 0.6rem;
  font-weight: 800;
  line-height: 1;
  color: #fff;
  background: rgb(var(--v-theme-error));
}

.notiflist {
  width: min(23rem, calc(100vw - 1.5rem));
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--tvz-shadow-lg);
}
.notiflist__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1rem;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  font-size: 0.92rem;
}
.notiflist__markall {
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-primary));
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
}
.notiflist__scroll {
  max-height: min(68vh, 30rem);
  overflow-y: auto;
  padding: 0.4rem;
}
.notiflist__empty {
  margin: 1.5rem 0.6rem;
  text-align: center;
  font-size: 0.85rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.notiflist__more {
  width: 100%;
  padding: 0.6rem;
  margin-top: 0.2rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgb(var(--v-theme-primary));
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}
.notiflist__more:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
}

.notifrow {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  width: 100%;
  padding: 0.65rem 0.6rem;
  border-radius: 8px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.14s cubic-bezier(0.22, 1, 0.36, 1);
}
.notifrow:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.notifrow__dot {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 0.4rem;
  border-radius: 50%;
  background: transparent;
}
.notifrow.is-unread .notifrow__dot {
  background: rgb(var(--v-theme-primary));
}
.notifrow__body {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.notifrow__body strong {
  font-size: 0.85rem;
}
.notifrow__text {
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.65);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.notifrow__time {
  font-size: 0.68rem;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
</style>

<style>
.notifmenu.v-overlay__content {
  background: transparent;
  box-shadow: none;
  border-radius: 0;
}
</style>
