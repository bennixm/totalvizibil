<script setup lang="ts">
import { computed } from 'vue'

import AdminHint from './AdminHint.vue'

const props = withDefaults(defineProps<{ label: string; hint: string; size?: 'sm' | 'md' }>(), {
  size: 'sm',
})

// The (i) must never end up alone on a new line when the label wraps. A
// plain `label <AdminHint>` lets the browser break right before the icon, so
// the last word and the icon are kept together in one unbreakable span.
const parts = computed(() => {
  const text = props.label.trim()
  const i = text.lastIndexOf(' ')
  return i < 0 ? { head: '', tail: text } : { head: text.slice(0, i + 1), tail: text.slice(i + 1) }
})
</script>

<template>
  <span class="ahtext"
    >{{ parts.head }}<span class="ahtext__tail"
      >{{ parts.tail }}<AdminHint :text="hint" :size="size" /></span
  ></span>
</template>

<style scoped>
.ahtext__tail {
  white-space: nowrap;
}
.ahtext__tail :deep(.ahint) {
  margin-left: 0.3rem;
  vertical-align: -2px;
}
</style>
