<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

import { useToastStore, type ToastKind } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const { items } = storeToRefs(toast)

const ICON: Record<ToastKind, string> = {
  success: 'mdi-check-circle-outline',
  error: 'mdi-alert-circle-outline',
  info: 'mdi-information-outline',
  warning: 'mdi-alert-outline',
}

/** A notification pop-up's text is `title\nbody` — bold just the first line,
 *  like the panel does, without changing the plain-string `Toast` shape. A
 *  one-line toast (every existing call site) has no second segment. */
function heading(text: string): string {
  return text.split('\n', 1)[0]
}
function rest(text: string): string {
  const i = text.indexOf('\n')
  return i === -1 ? '' : text.slice(i + 1)
}
</script>

<template>
  <Teleport to="body">
    <div class="toasts" role="region" aria-live="polite" aria-label="Alerte">
      <TransitionGroup name="toast">
        <div
          v-for="tt in items"
          :key="tt.id"
          class="toast"
          :class="`toast--${tt.kind}`"
          role="alert"
        >
          <v-icon :icon="ICON[tt.kind]" size="20" class="toast__ic" />
          <div class="toast__body">
            <p class="toast__text" :class="{ 'toast__text--heading': rest(tt.text) }">
              {{ heading(tt.text) }}
            </p>
            <p v-if="rest(tt.text)" class="toast__sub">{{ rest(tt.text) }}</p>
            <RouterLink
              v-if="tt.action"
              class="toast__action"
              :to="tt.action.to"
              @click="toast.dismiss(tt.id)"
            >
              {{ tt.action.label }}
            </RouterLink>
          </div>
          <button
            type="button"
            class="toast__x"
            :aria-label="t('common.close')"
            @click="toast.dismiss(tt.id)"
          >
            <v-icon icon="mdi-close" size="16" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toasts {
  position: fixed;
  top: calc(var(--tvz-topbar-h, 64px) + 12px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 3000;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: min(420px, calc(100vw - 2rem));
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.7rem 0.75rem 0.7rem 0.85rem;
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--tvz-glass-border);
  border-left: 3px solid rgb(var(--v-theme-primary));
  box-shadow: var(--tvz-shadow-lg);
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.875rem;
  line-height: 1.45;
}
.toast--success {
  border-left-color: rgb(var(--v-theme-success));
}
.toast--error {
  border-left-color: rgb(var(--v-theme-error));
}
.toast--warning {
  border-left-color: rgb(var(--v-theme-warning));
}
.toast--info {
  border-left-color: rgb(var(--v-theme-info));
}
.toast__ic {
  flex: none;
  margin-top: 1px;
}
.toast--success .toast__ic {
  color: rgb(var(--v-theme-success));
}
.toast--error .toast__ic {
  color: rgb(var(--v-theme-error));
}
.toast--warning .toast__ic {
  color: rgb(var(--v-theme-warning));
}
.toast--info .toast__ic {
  color: rgb(var(--v-theme-info));
}
.toast__body {
  flex: 1;
  min-width: 0;
}
.toast__text {
  margin: 0;
}
.toast__text--heading {
  font-weight: 700;
}
.toast__sub {
  margin: 0.2rem 0 0;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.toast__action {
  display: inline-block;
  margin-top: 0.35rem;
  font-weight: 600;
  font-size: 0.82rem;
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}
.toast__action:hover {
  text-decoration: underline;
}
.toast__x {
  flex: none;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 0;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.55);
  cursor: pointer;
  transition: background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.toast__x:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgb(var(--v-theme-on-surface));
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--tvz-dur-med) var(--tvz-ease-out),
    transform var(--tvz-dur-med) var(--tvz-ease-out);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
.toast-leave-active {
  position: absolute;
  width: 100%;
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: none;
  }
}
</style>
