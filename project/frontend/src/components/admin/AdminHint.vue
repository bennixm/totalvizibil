<script setup lang="ts">
withDefaults(defineProps<{ text: string; size?: 'sm' | 'md' }>(), { size: 'md' })
</script>

<!--
  The explanatory copy admin panels used to show as a permanent paragraph
  under every section title / field label — correct, but it added up to a
  lot of always-on gray text. This renders a small (i) trigger instead: the
  text only appears in a tooltip on hover, focus or tap, so the page reads
  clean by default and the explanation is still one interaction away, never
  hidden behind a second screen or a settings toggle.
-->
<template>
  <v-tooltip :text="text" location="top" max-width="280" open-on-click>
    <template #activator="{ props: tipProps }">
      <button
        v-bind="tipProps"
        type="button"
        class="ahint"
        :class="`ahint--${size}`"
        :aria-label="text"
      >
        <v-icon icon="mdi-information-outline" :size="size === 'sm' ? 12 : 14" />
      </button>
    </template>
  </v-tooltip>
</template>

<style scoped>
.ahint {
  display: inline-grid;
  place-items: center;
  flex: none;
  border: none;
  border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.45);
  cursor: help;
  padding: 0;
  transition:
    background var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease),
    color var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease);
}
.ahint--md {
  width: 18px;
  height: 18px;
}
.ahint--sm {
  width: 16px;
  height: 16px;
}
.ahint:hover,
.ahint:focus-visible {
  background: rgba(var(--v-theme-primary), 0.16);
  color: rgb(var(--v-theme-primary));
}
.ahint:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
</style>
