<script setup lang="ts">
/**
 * The platform's password field: a normal `v-text-field` plus an eye button
 * that shows / hides what was typed. Used for EVERY password input (login,
 * sign-up, reset, account security, admin), so they all behave the same.
 *
 * Every attribute (v-model, label, hint, autocomplete, density, rules…) and
 * every slot goes straight to the `v-text-field`; an `append-inner` slot
 * passed by the caller is kept, with the eye button placed after it.
 */
import { computed, ref, useSlots } from 'vue'
import { useI18n } from 'vue-i18n'

defineOptions({ inheritAttrs: false })

const { t } = useI18n()
const slots = useSlots()
const visible = ref(false)
// All caller slots except `append-inner`, which this component renders itself.
const passThrough = computed(() => Object.keys(slots).filter((n) => n !== 'append-inner'))
</script>

<template>
  <v-text-field
    v-bind="$attrs"
    :type="visible ? 'text' : 'password'"
    autocapitalize="off"
    autocorrect="off"
    spellcheck="false"
  >
    <template v-for="name in passThrough" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps ?? {}" />
    </template>
    <template #append-inner>
      <slot name="append-inner" />
      <!-- mousedown.prevent keeps the caret in the input while toggling. -->
      <button
        type="button"
        class="pwf__eye"
        :aria-label="visible ? t('auth.hidePassword') : t('auth.showPassword')"
        :aria-pressed="visible"
        :title="visible ? t('auth.hidePassword') : t('auth.showPassword')"
        @mousedown.prevent
        @click="visible = !visible"
      >
        <v-icon :icon="visible ? 'mdi-eye-off-outline' : 'mdi-eye-outline'" size="20" />
      </button>
    </template>
  </v-text-field>
</template>

<style scoped>
.pwf__eye {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-right: -4px;
  border-radius: 50%;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}
.pwf__eye:hover {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.pwf__eye:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}
</style>
