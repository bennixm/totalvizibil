<script setup lang="ts">
/**
 * The platform's one date field. Replaces the browser's native
 * `<input type="date">`, which rendered differently in every browser and
 * showed the OS format ("mm/dd/yyyy") instead of the interface language.
 *
 * Value in / out is the same plain `YYYY-MM-DD` string the native input
 * used (or `''` for none), so it is a drop-in swap. Every other attribute
 * (label, density, variant, hide-details, hint, class…) is passed straight
 * to the underlying `v-text-field`, so it looks like the fields around it.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    modelValue?: string | null
    /** Earliest selectable day, `YYYY-MM-DD`. */
    min?: string
    /** Latest selectable day, `YYYY-MM-DD`. */
    max?: string
    clearable?: boolean
    disabled?: boolean
  }>(),
  { modelValue: '', min: undefined, max: undefined, clearable: true, disabled: false },
)
const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [value: string] }>()

const { locale, t } = useI18n()
const open = ref(false)

function parse(iso: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}
function toIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const picked = computed(() => parse(props.modelValue))
const display = computed(() =>
  picked.value
    ? picked.value.toLocaleDateString(locale.value === 'en' ? 'en-GB' : locale.value, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : '',
)

function set(value: string): void {
  if (value === (props.modelValue ?? '')) return
  emit('update:modelValue', value)
  emit('change', value)
}
function onPick(d: unknown): void {
  if (d instanceof Date) set(toIso(d))
  open.value = false
}
</script>

<template>
  <v-menu v-model="open" :close-on-content-click="false" :disabled="disabled" location="bottom start">
    <template #activator="{ props: menuProps }">
      <v-text-field
        :placeholder="t('common.datePlaceholder')"
        v-bind="{ ...$attrs, ...menuProps }"
        :model-value="display"
        readonly
        :disabled="disabled"
        prepend-inner-icon="mdi-calendar-blank-outline"
        :clearable="clearable && !!picked"
        class="app-date"
        @click:clear.stop="set('')"
      />
    </template>
    <v-date-picker
      :model-value="picked"
      :min="min"
      :max="max"
      hide-header
      show-adjacent-months
      color="primary"
      @update:model-value="onPick"
    />
  </v-menu>
</template>

<style scoped>
.app-date {
  /* Room for the whole "zz.ll.aaaa" plus the calendar and clear icons. */
  min-width: 158px;
}
.app-date :deep(input) {
  cursor: pointer;
}
</style>
