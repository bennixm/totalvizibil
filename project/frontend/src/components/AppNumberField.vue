<script setup lang="ts">
/**
 * A decimal number field that writes and reads the interface language's
 * decimal separator. `<input type="number">` always shows "1.1" (and some
 * browsers reject "1,1" outright), while every other credit figure on the
 * page reads "1,1" in Romanian/German.
 *
 * `v-model` stays a plain `number` (`NaN` while the text is not a number
 * yet, so callers' existing `Number.isFinite` guards keep working). All
 * other attributes go straight to the underlying `v-text-field`.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{ modelValue?: number | null; maxDecimals?: number }>(), {
  modelValue: null,
  maxDecimals: 2,
})
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const { locale } = useI18n()
const sep = computed(() => (locale.value === 'en' ? '.' : ','))

function format(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return ''
  const fixed = Number(n.toFixed(props.maxDecimals)).toString()
  return fixed.replace('.', sep.value)
}
function parse(text: string): number {
  const cleaned = text.trim().replace(/\s/g, '').replace(',', '.')
  if (!cleaned || !/^-?\d*\.?\d*$/.test(cleaned) || cleaned === '.' || cleaned === '-') return NaN
  return Number(cleaned)
}

const text = ref(format(props.modelValue))
// Outside changes (a preset card, a reload) rewrite the text; the user's own
// typing does not get reformatted under the cursor.
watch(
  () => props.modelValue,
  (v) => {
    if (parse(text.value) !== v) text.value = format(v)
  },
)
watch(sep, () => (text.value = format(parse(text.value))))

function onInput(v: string | null): void {
  text.value = v ?? ''
  emit('update:modelValue', parse(text.value))
}
</script>

<template>
  <v-text-field
    v-bind="$attrs"
    :model-value="text"
    type="text"
    inputmode="decimal"
    autocomplete="off"
    @update:model-value="onInput"
    @blur="text = format(parse(text))"
  >
    <template v-for="(_, name) in $slots" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps ?? {}" />
    </template>
  </v-text-field>
</template>
