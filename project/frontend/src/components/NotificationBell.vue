<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import {
  routeForNotification,
  useNotificationsStore,
  visualForNotification,
  type NotificationItem,
} from '@/stores/notifications'

const { t, locale } = useI18n()
const router = useRouter()
const store = useNotificationsStore()
const { items, unreadCount, nextCursor, loading, loadError } = storeToRefs(store)

const menuOpen = ref(false)
const badgeText = computed(() => (unreadCount.value > 9 ? '9+' : String(unreadCount.value)))
const initialLoading = computed(() => loading.value && items.value.length === 0)

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
  void store.markRead(n.id)
  const to = routeForNotification(n)
  if (to) {
    menuOpen.value = false
    void router.push(to)
  }
}

function dismiss(event: Event, id: string): void {
  event.stopPropagation()
  void store.dismiss(id)
}

function onRowKeydown(event: KeyboardEvent, n: NotificationItem): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    openNotification(n)
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
        <div v-if="initialLoading" class="notiflist__center">
          <v-progress-circular indeterminate size="22" width="2" color="primary" />
        </div>

        <div v-else-if="loadError" class="notiflist__center notiflist__center--error">
          <v-icon icon="mdi-cloud-alert-outline" size="22" />
          <span>{{ t('notifications.loadError') }}</span>
          <button type="button" class="notiflist__retry" @click="store.load(false)">
            {{ t('notifications.retry') }}
          </button>
        </div>

        <div v-else-if="!items.length" class="notiflist__empty">
          <v-icon icon="mdi-bell-off-outline" size="22" />
          <span>{{ t('notifications.empty') }}</span>
        </div>

        <template v-else>
          <div
            v-for="n in items"
            :key="n.id"
            class="notifrow"
            :class="[`notifrow--${visualForNotification(n.type).tone}`, { 'is-unread': !n.readAt }]"
            role="button"
            tabindex="0"
            @click="openNotification(n)"
            @keydown="onRowKeydown($event, n)"
          >
            <span class="notifrow__ic">
              <v-icon :icon="visualForNotification(n.type).icon" size="16" />
            </span>
            <span class="notifrow__body">
              <span class="notifrow__title">
                <strong>{{ n.title }}</strong>
                <span v-if="!n.readAt" class="notifrow__dot" aria-hidden="true" />
              </span>
              <span class="notifrow__text">{{ n.body }}</span>
              <span class="notifrow__time">{{ ago(n.createdAt) }}</span>
            </span>
            <button
              type="button"
              class="notifrow__x"
              :aria-label="t('notifications.dismiss')"
              @click="dismiss($event, n.id)"
            >
              <v-icon icon="mdi-close" size="14" />
            </button>
          </div>
          <button
            v-if="nextCursor"
            type="button"
            class="notiflist__more"
            :disabled="loading"
            @click="store.load(true)"
          >
            <v-progress-circular v-if="loading" indeterminate size="14" width="2" />
            <template v-else>{{ t('notifications.loadMore') }}</template>
          </button>
        </template>
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
  width: min(24rem, calc(100vw - 1.5rem));
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
.notiflist__center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem 0.6rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.notiflist__center--error {
  color: rgb(var(--v-theme-error));
}
.notiflist__retry {
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-primary));
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}
.notiflist__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  margin: 1rem 0.6rem;
  padding: 1rem 0;
  text-align: center;
  font-size: 0.85rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.notiflist__more {
  display: flex;
  align-items: center;
  justify-content: center;
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
.notiflist__more:hover:not(:disabled) {
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.notiflist__more:disabled {
  cursor: default;
}

.notifrow {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  width: 100%;
  padding: 0.65rem 2rem 0.65rem 0.6rem;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.14s cubic-bezier(0.22, 1, 0.36, 1);
}
.notifrow:hover,
.notifrow:focus-visible {
  outline: none;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.notifrow.is-unread {
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.notifrow__title {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.notifrow__dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
}
.notifrow--success .notifrow__dot {
  background: rgb(var(--v-theme-success));
}
.notifrow--warning .notifrow__dot {
  background: rgb(var(--v-theme-warning));
}
.notifrow--error .notifrow__dot {
  background: rgb(var(--v-theme-error));
}
.notifrow__ic {
  flex: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin-top: 0.1rem;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.notifrow--primary .notifrow__ic {
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}
.notifrow--success .notifrow__ic {
  background: rgba(var(--v-theme-success), 0.14);
  color: rgb(var(--v-theme-success));
}
.notifrow--warning .notifrow__ic {
  background: rgba(var(--v-theme-warning), 0.16);
  color: rgb(var(--v-theme-warning));
}
.notifrow--error .notifrow__ic {
  background: rgba(var(--v-theme-error), 0.14);
  color: rgb(var(--v-theme-error));
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
.notifrow__x {
  position: absolute;
  top: 0.5rem;
  right: 0.4rem;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.35);
  opacity: 0;
  transition:
    opacity var(--tvz-dur-fast) var(--tvz-ease-out),
    background var(--tvz-dur-fast) var(--tvz-ease-out),
    color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.notifrow:hover .notifrow__x,
.notifrow:focus-within .notifrow__x {
  opacity: 1;
}
.notifrow__x:hover {
  background: rgba(var(--v-theme-error), 0.12);
  color: rgb(var(--v-theme-error));
}

/* No hover on touch devices — the X must stay reachable without one. */
@media (hover: none) {
  .notifrow__x {
    opacity: 0.6;
  }
}
</style>

<style>
.notifmenu.v-overlay__content {
  background: transparent;
  box-shadow: none;
  border-radius: 0;
}
</style>
