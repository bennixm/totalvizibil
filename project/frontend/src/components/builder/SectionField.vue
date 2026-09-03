<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useBuilderStore, type FieldSpec } from '@/stores/builder'

const props = defineProps<{
  spec: FieldSpec
  modelValue: unknown
  companyId: string
  /** Hide the field's own label row (used inside item cards where space is tight). */
  bare?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()

const { t } = useI18n()
const store = useBuilderStore()

const label = computed(() => {
  const k = `builder.field.${props.spec.label}`
  const s = t(k)
  return s === k ? props.spec.label : s
})

const asString = computed(() => (typeof props.modelValue === 'string' ? props.modelValue : ''))
const asBool = computed(() => props.modelValue === true)
const asArray = computed(() => (Array.isArray(props.modelValue) ? props.modelValue : []))

function set(v: unknown): void {
  emit('update:modelValue', v)
}

// --- list (string[]) ---
function setListAt(i: number, v: string): void {
  const next = [...(asArray.value as string[])]
  next[i] = v
  set(next)
}
function addListRow(): void {
  if (asArray.value.length < (props.spec.itemMax ?? 8)) set([...(asArray.value as string[]), ''])
}
function removeListRow(i: number): void {
  set((asArray.value as string[]).filter((_, idx) => idx !== i))
}

// --- items (object[]) ---
function emptyRow(): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const f of props.spec.itemFields ?? []) row[f.key] = f.type === 'boolean' ? false : f.type === 'list' || f.type === 'items' ? [] : ''
  return row
}
function setItemField(i: number, key: string, v: unknown): void {
  const next = (asArray.value as Record<string, unknown>[]).map((row, idx) =>
    idx === i ? { ...row, [key]: v } : row,
  )
  set(next)
}
function addItem(): void {
  if (asArray.value.length < (props.spec.itemMax ?? 12)) set([...asArray.value, emptyRow()])
}
function removeItem(i: number): void {
  set((asArray.value as unknown[]).filter((_, idx) => idx !== i))
}
function moveItem(i: number, dir: -1 | 1): void {
  const next = [...(asArray.value as unknown[])]
  const j = i + dir
  if (j < 0 || j >= next.length) return
  ;[next[i], next[j]] = [next[j], next[i]]
  set(next)
}

// --- image ---
const uploading = ref(false)
async function onImage(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !file.type.startsWith('image/')) return
  uploading.value = true
  try {
    const dataUri = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(new Error('read'))
      r.readAsDataURL(file)
    })
    const kind = imageKind(props.spec.key)
    const url = await store.uploadAsset(props.companyId, kind, dataUri)
    if (url) set(url)
  } finally {
    uploading.value = false
  }
}
function imageKind(key: string): string {
  if (key === 'backgroundImage') return 'hero'
  if (key === 'imageUrl') return 'gallery'
  return 'gallery'
}
</script>

<template>
  <div class="fld" :class="{ 'fld--bare': bare }">
    <label v-if="!bare" class="fld__k">{{ label }}</label>

    <!-- text / url -->
    <input
      v-if="spec.type === 'text' || spec.type === 'url'"
      class="fld__in"
      :type="spec.type === 'url' ? 'url' : 'text'"
      :maxlength="spec.maxLength"
      :value="asString"
      :placeholder="label"
      @input="set(($event.target as HTMLInputElement).value)"
    />

    <!-- textarea / richtext -->
    <textarea
      v-else-if="spec.type === 'textarea' || spec.type === 'richtext'"
      class="fld__in fld__area"
      :rows="spec.type === 'richtext' ? 6 : 3"
      :maxlength="spec.maxLength"
      :value="asString"
      :placeholder="label"
      @input="set(($event.target as HTMLTextAreaElement).value)"
    />

    <!-- boolean -->
    <button
      v-else-if="spec.type === 'boolean'"
      type="button"
      class="fld__tog"
      :class="{ 'is-on': asBool }"
      @click="set(!asBool)"
    >
      {{ asBool ? t('builder.on') : t('builder.off') }}
    </button>

    <!-- enum -->
    <div v-else-if="spec.type === 'enum'" class="fld__chips">
      <button
        v-for="opt in spec.enumValues ?? []"
        :key="opt"
        type="button"
        class="chip"
        :class="{ 'is-on': asString === opt }"
        @click="set(opt)"
      >
        {{ t(`builder.opt.${opt}`) === `builder.opt.${opt}` ? opt : t(`builder.opt.${opt}`) }}
      </button>
    </div>

    <!-- image -->
    <div v-else-if="spec.type === 'image'" class="fld__img">
      <img v-if="asString" :src="asString" alt="" />
      <div class="fld__imgRow">
        <label class="mini">
          <v-progress-circular v-if="uploading" indeterminate size="14" width="2" />
          <template v-else>
            <v-icon :icon="asString ? 'mdi-image-refresh-outline' : 'mdi-tray-arrow-up'" size="14" />
            {{ asString ? t('builder.imageChange') : t('builder.imageAdd') }}
          </template>
          <input type="file" accept="image/*" :disabled="uploading" @change="onImage" />
        </label>
        <button v-if="asString" type="button" class="mini mini--x" @click="set('')">
          <v-icon icon="mdi-close" size="14" />
        </button>
      </div>
    </div>

    <!-- list (string[]) -->
    <div v-else-if="spec.type === 'list'" class="fld__list">
      <div v-for="(row, i) in asArray as string[]" :key="i" class="fld__lrow">
        <input
          class="fld__in"
          type="text"
          :maxlength="spec.maxLength"
          :value="row"
          @input="setListAt(i, ($event.target as HTMLInputElement).value)"
        />
        <button type="button" class="mini mini--x" @click="removeListRow(i)">
          <v-icon icon="mdi-close" size="14" />
        </button>
      </div>
      <button
        v-if="asArray.length < (spec.itemMax ?? 8)"
        type="button"
        class="fld__add"
        @click="addListRow"
      >
        <v-icon icon="mdi-plus" size="14" /> {{ t('builder.addRow') }}
      </button>
    </div>

    <!-- items (object[]) -->
    <div v-else-if="spec.type === 'items'" class="fld__items">
      <div v-for="(row, i) in asArray as Record<string, unknown>[]" :key="i" class="fld__card">
        <div class="fld__cardBar">
          <span>{{ label }} {{ i + 1 }}</span>
          <span class="fld__cardActs">
            <button type="button" :disabled="i === 0" @click="moveItem(i, -1)">
              <v-icon icon="mdi-chevron-up" size="16" />
            </button>
            <button type="button" :disabled="i === asArray.length - 1" @click="moveItem(i, 1)">
              <v-icon icon="mdi-chevron-down" size="16" />
            </button>
            <button type="button" @click="removeItem(i)"><v-icon icon="mdi-close" size="15" /></button>
          </span>
        </div>
        <SectionField
          v-for="f in spec.itemFields ?? []"
          :key="f.key"
          :spec="f"
          :company-id="companyId"
          :model-value="row[f.key]"
          @update:model-value="setItemField(i, f.key, $event)"
        />
      </div>
      <button
        v-if="asArray.length < (spec.itemMax ?? 12)"
        type="button"
        class="fld__add"
        @click="addItem"
      >
        <v-icon icon="mdi-plus" size="14" /> {{ t('builder.addRow') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.fld {
  margin-bottom: 0.7rem;
}
.fld--bare {
  margin-bottom: 0.5rem;
}
.fld__k {
  display: block;
  margin-bottom: 0.3rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.fld__in {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border-radius: 8px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  color: inherit;
  font: inherit;
  font-size: 0.85rem;
}
.fld__in:focus {
  outline: 2px solid rgb(var(--v-theme-primary) / 0.4);
  outline-offset: 1px;
}
.fld__area {
  resize: vertical;
  line-height: 1.45;
}
.fld__tog {
  padding: 0.25rem 0.7rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgb(var(--v-theme-on-surface) / 0.55);
  background: rgb(var(--v-theme-on-surface) / 0.08);
}
.fld__tog.is-on {
  color: #fff;
  background: rgb(var(--v-theme-primary));
}
.fld__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.chip {
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
  border: 1px solid var(--tvz-glass-border);
  color: rgb(var(--v-theme-on-surface) / 0.7);
  background: rgb(var(--v-theme-surface));
}
.chip.is-on {
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary) / 0.08);
}
.fld__img img {
  display: block;
  width: 100%;
  max-height: 120px;
  object-fit: cover;
  border-radius: 8px;
  margin-bottom: 0.4rem;
}
.fld__imgRow {
  display: flex;
  gap: 0.4rem;
}
.mini {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.3rem 0.6rem;
  border-radius: 7px;
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
}
.mini input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.mini--x {
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.fld__lrow,
.fld__imgRow {
  align-items: center;
}
.fld__lrow {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 0.35rem;
}
.fld__add {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.6rem;
  border-radius: 8px;
  font-size: 0.75rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  border: 1px dashed rgb(var(--v-theme-primary) / 0.4);
}
.fld__card {
  padding: 0.6rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 9px;
  margin-bottom: 0.5rem;
  background: rgb(var(--v-theme-on-surface) / 0.02);
}
.fld__cardBar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.4rem;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
.fld__cardActs {
  display: flex;
  gap: 0.1rem;
}
.fld__cardActs button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.fld__cardActs button:disabled {
  opacity: 0.3;
}
.fld__cardActs button:hover:not(:disabled) {
  background: rgb(var(--v-theme-on-surface) / 0.08);
}
</style>
