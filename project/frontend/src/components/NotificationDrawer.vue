<script setup lang="ts">
import { computed } from 'vue'
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
const { items, unreadCount, nextCursor, loading, loadError, drawerOpen } = storeToRefs(store)

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

function openNotification(n: NotificationItem): void {
  void store.markRead(n.id)
  const to = routeForNotification(n)
  if (to) {
    drawerOpen.value = false
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
  <v-navigation-drawer v-model="drawerOpen" location="right" temporary width="440" class="notifdrawer">
    <header class="notiflist__head">
      <strong>{{ t('notifications.bell') }}</strong>
      <div class="notiflist__headActions">
        <button
          v-if="unreadCount > 0"
          type="button"
          class="notiflist__markall"
          @click="store.markAllRead()"
        >
          {{ t('notifications.markAllRead') }}
        </button>
        <button
          type="button"
          class="notiflist__close"
          :aria-label="t('common.close')"
          @click="drawerOpen = false"
        >
          <v-icon icon="mdi-close" size="20" />
        </button>
      </div>
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
            <v-icon :icon="visualForNotification(n.type).icon" size="19" />
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
            <v-icon icon="mdi-close" size="15" />
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
  </v-navigation-drawer>
</template>

<style scoped>
.notifdrawer {
  max-width: 100vw;
  /* Same 10px gap below the navbar as the side menu — Vuetify sets its own
     top/height as inline styles from the registered app-bar height, so
     these need `!important` to win. */
  top: calc(var(--tvz-topbar-h) + 10px) !important;
  height: calc(100dvh - var(--tvz-topbar-h) - 10px) !important;
}
/* On mobile the fixed bottom tab bar replaces the footer as the persistent
   nav — without this the drawer's height ran all the way to the bottom of
   the viewport and sat on top of it (higher z-index), hiding it entirely
   while the drawer was open. */
@media (max-width: 959px) {
  .notifdrawer {
    height: calc(
      100dvh - var(--tvz-topbar-h) - 10px - var(--tvz-tabbar-h) - env(safe-area-inset-bottom, 0px)
    ) !important;
  }
}
/* Vuetify's own internal content wrapper scrolls by default (overflow-y:
   auto) — with our own `.notiflist__scroll` handling the list's scroll,
   that left two independent scrollbars stacked on top of each other. Turn
   this one into a plain flex column instead, so only the list itself
   scrolls. */
.notifdrawer :deep(.v-navigation-drawer__content) {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.notiflist__head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.1rem 1.25rem;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  font-size: 1.05rem;
}
.notiflist__headActions {
  display: flex;
  align-items: center;
  gap: 0.9rem;
}
.notiflist__markall {
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-primary));
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}
.notiflist__close {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 0;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer;
  transition: background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.notiflist__close:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.notiflist__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0.6rem;
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
  gap: 0.8rem;
  width: 100%;
  padding: 0.85rem 2.2rem 0.85rem 0.8rem;
  border-radius: 10px;
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
  width: 34px;
  height: 34px;
  margin-top: 0.1rem;
  border-radius: 9px;
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
  font-size: 0.95rem;
}
.notifrow__text {
  font-size: 0.85rem;
  color: rgba(var(--v-theme-on-surface), 0.65);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
.notifrow__time {
  font-size: 0.74rem;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.notifrow__x {
  position: absolute;
  top: 0.7rem;
  right: 0.5rem;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
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
