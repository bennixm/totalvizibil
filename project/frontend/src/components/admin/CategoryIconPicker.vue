<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CATEGORY_ICONS } from '@/utils/categoryIcons'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()
const { t } = useI18n()

const open = ref(false)
const query = ref('')

function deburr(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

const filtered = computed(() => {
  const q = deburr(query.value.trim())
  if (!q) return CATEGORY_ICONS
  return CATEGORY_ICONS.filter(
    (i) => deburr(i.icon).includes(q) || deburr(i.keywords).includes(q),
  )
})

function pick(icon: string) {
  emit('update:modelValue', icon)
  open.value = false
}
function clear() {
  emit('update:modelValue', '')
  open.value = false
}
</script>

<template>
  <v-menu v-model="open" :close-on-content-click="false" location="bottom start" min-width="320" max-width="340">
    <template #activator="{ props: menuProps }">
      <v-text-field
        v-bind="menuProps"
        :model-value="props.modelValue"
        :label="t('adminCat.icon')"
        :hint="t('adminCat.iconHint')"
        persistent-hint
        density="comfortable"
        readonly
        @click="query = ''"
      >
        <template #prepend-inner>
          <v-icon :icon="props.modelValue || 'mdi-shape-outline'" />
        </template>
      </v-text-field>
    </template>
    <v-card rounded="lg">
      <v-card-text class="cip__body">
        <v-text-field
          v-model="query"
          :placeholder="t('adminCat.iconSearch')"
          density="compact"
          variant="outlined"
          hide-details
          prepend-inner-icon="mdi-magnify"
          autofocus
          clearable
        />
        <div class="cip__grid">
          <button
            v-for="i in filtered"
            :key="i.icon"
            type="button"
            class="cip__cell"
            :class="{ 'cip__cell--active': i.icon === props.modelValue }"
            :title="i.icon"
            @click="pick(i.icon)"
          >
            <v-icon :icon="i.icon" size="20" />
          </button>
          <p v-if="!filtered.length" class="cip__empty">{{ t('adminCat.iconNoMatch') }}</p>
        </div>
        <button v-if="props.modelValue" type="button" class="cip__clear" @click="clear">
          <v-icon icon="mdi-close" size="14" /> {{ t('adminCat.iconClear') }}
        </button>
      </v-card-text>
    </v-card>
  </v-menu>
</template>

<style scoped>
.cip__body {
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.cip__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
  gap: 0.3rem;
  max-height: 220px;
  overflow-y: auto;
}
.cip__cell {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.75);
  cursor: pointer;
  transition:
    border-color var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease),
    color var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease),
    background var(--tvz-dur-fast, 0.15s) var(--tvz-ease-out, ease);
}
.cip__cell:hover {
  border-color: rgb(var(--v-theme-primary) / 0.6);
  color: rgb(var(--v-theme-primary));
}
.cip__cell--active {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.cip__empty {
  grid-column: 1 / -1;
  margin: 0.5rem 0;
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.cip__clear {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  align-self: flex-start;
  border: none;
  background: none;
  padding: 0;
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
  cursor: pointer;
}
.cip__clear:hover {
  color: rgb(var(--v-theme-error));
}
</style>
