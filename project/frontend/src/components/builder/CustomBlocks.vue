<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useBuilderStore } from '@/stores/builder'

type Block = Record<string, unknown>

const props = defineProps<{ modelValue: unknown; companyId: string; max?: number }>()
const emit = defineEmits<{ 'update:modelValue': [value: Block[]] }>()

const { t } = useI18n()
const store = useBuilderStore()

const blocks = computed<Block[]>(() => (Array.isArray(props.modelValue) ? (props.modelValue as Block[]) : []))
const limit = computed(() => props.max ?? 24)

const KINDS = ['heading', 'text', 'image', 'button', 'spacer', 'divider'] as const
type Kind = (typeof KINDS)[number]
const KIND_ICON: Record<Kind, string> = {
  heading: 'mdi-format-header-pound',
  text: 'mdi-text',
  image: 'mdi-image-outline',
  button: 'mdi-gesture-tap-button',
  spacer: 'mdi-arrow-expand-vertical',
  divider: 'mdi-minus',
}

function kindLabel(k: string): string {
  const key = `builder.customBlock.kind.${k}`
  const s = t(key)
  return s === key ? k : s
}
function optLabel(o: string): string {
  const key = `builder.opt.${o}`
  const s = t(key)
  return s === key ? o : s
}

function make(kind: Kind): Block {
  switch (kind) {
    case 'heading':
      return { kind, text: '', size: 'lg', color: '' }
    case 'image':
      return { kind, url: '', caption: '' }
    case 'button':
      return { kind, label: '', target: 'contact', variant: 'solid' }
    case 'spacer':
      return { kind, size: 'md' }
    case 'divider':
      return { kind }
    case 'text':
    default:
      return { kind: 'text', text: '', color: '' }
  }
}

function commit(next: Block[]): void {
  emit('update:modelValue', next)
}
function add(kind: Kind): void {
  if (blocks.value.length >= limit.value) return
  commit([...blocks.value, make(kind)])
}
function patch(i: number, key: string, val: unknown): void {
  commit(blocks.value.map((b, idx) => (idx === i ? { ...b, [key]: val } : b)))
}
function remove(i: number): void {
  commit(blocks.value.filter((_, idx) => idx !== i))
}
function move(i: number, dir: -1 | 1): void {
  const next = [...blocks.value]
  const j = i + dir
  if (j < 0 || j >= next.length) return
  ;[next[i], next[j]] = [next[j], next[i]]
  commit(next)
}

// --- image upload (mirrors SectionField) ---
const uploadingAt = ref<number | null>(null)
async function onImage(i: number, e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !file.type.startsWith('image/')) return
  uploadingAt.value = i
  try {
    const dataUri = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(new Error('read'))
      r.readAsDataURL(file)
    })
    const url = await store.uploadAsset(props.companyId, 'gallery', dataUri)
    if (url) patch(i, 'url', url)
  } finally {
    uploadingAt.value = null
  }
}
</script>

<template>
  <div class="cb">
    <div v-for="(b, i) in blocks" :key="i" class="cb__card">
      <div class="cb__bar">
        <span class="cb__kind">
          <v-icon :icon="KIND_ICON[(b.kind as Kind)] || 'mdi-shape-outline'" size="14" />
          {{ kindLabel(b.kind as string) }}
        </span>
        <span class="cb__acts">
          <button type="button" :disabled="i === 0" @click="move(i, -1)">
            <v-icon icon="mdi-chevron-up" size="16" />
          </button>
          <button type="button" :disabled="i === blocks.length - 1" @click="move(i, 1)">
            <v-icon icon="mdi-chevron-down" size="16" />
          </button>
          <button type="button" @click="remove(i)"><v-icon icon="mdi-close" size="15" /></button>
        </span>
      </div>

      <!-- heading -->
      <template v-if="b.kind === 'heading'">
        <input
          class="cb__in"
          type="text"
          maxlength="160"
          :value="(b.text as string) || ''"
          :placeholder="t('builder.customBlock.headingPh')"
          @input="patch(i, 'text', ($event.target as HTMLInputElement).value)"
        />
        <div class="cb__chips">
          <button
            v-for="o in ['lg', 'md', 'sm']"
            :key="o"
            type="button"
            class="chip"
            :class="{ 'is-on': (b.size || 'lg') === o }"
            @click="patch(i, 'size', o)"
          >
            {{ optLabel(o) }}
          </button>
          <span class="cb__colorPick" :class="{ 'is-set': !!b.color }">
            <span class="cb__colorSw" :style="{ background: (b.color as string) || 'transparent' }" />
            {{ t('builder.customBlock.color') }}
            <input
              type="color"
              :value="(b.color as string) || '#111111'"
              @input="patch(i, 'color', ($event.target as HTMLInputElement).value)"
            />
          </span>
          <button v-if="b.color" type="button" class="cb__colorX" @click="patch(i, 'color', '')">
            <v-icon icon="mdi-close" size="12" />
          </button>
        </div>
      </template>

      <!-- text -->
      <template v-else-if="b.kind === 'text'">
        <textarea
          class="cb__in cb__area"
          rows="4"
          maxlength="1500"
          :value="(b.text as string) || ''"
          :placeholder="t('builder.customBlock.textPh')"
          @input="patch(i, 'text', ($event.target as HTMLTextAreaElement).value)"
        />
        <div class="cb__chips">
          <span class="cb__colorPick" :class="{ 'is-set': !!b.color }">
            <span class="cb__colorSw" :style="{ background: (b.color as string) || 'transparent' }" />
            {{ t('builder.customBlock.color') }}
            <input
              type="color"
              :value="(b.color as string) || '#111111'"
              @input="patch(i, 'color', ($event.target as HTMLInputElement).value)"
            />
          </span>
          <button v-if="b.color" type="button" class="cb__colorX" @click="patch(i, 'color', '')">
            <v-icon icon="mdi-close" size="12" />
          </button>
        </div>
      </template>

      <!-- image -->
      <template v-else-if="b.kind === 'image'">
        <img v-if="b.url" :src="(b.url as string)" alt="" class="cb__img" />
        <div class="cb__imgRow">
          <label class="mini">
            <v-progress-circular v-if="uploadingAt === i" indeterminate size="14" width="2" />
            <template v-else>
              <v-icon :icon="b.url ? 'mdi-image-refresh-outline' : 'mdi-tray-arrow-up'" size="14" />
              {{ b.url ? t('builder.imageChange') : t('builder.imageAdd') }}
            </template>
            <input type="file" accept="image/*" :disabled="uploadingAt === i" @change="onImage(i, $event)" />
          </label>
          <button v-if="b.url" type="button" class="mini mini--x" @click="patch(i, 'url', '')">
            <v-icon icon="mdi-close" size="14" />
          </button>
        </div>
        <input
          class="cb__in"
          type="text"
          maxlength="160"
          :value="(b.caption as string) || ''"
          :placeholder="t('builder.customBlock.captionPh')"
          @input="patch(i, 'caption', ($event.target as HTMLInputElement).value)"
        />
      </template>

      <!-- button -->
      <template v-else-if="b.kind === 'button'">
        <input
          class="cb__in"
          type="text"
          maxlength="40"
          :value="(b.label as string) || ''"
          :placeholder="t('builder.customBlock.btnLabelPh')"
          @input="patch(i, 'label', ($event.target as HTMLInputElement).value)"
        />
        <input
          class="cb__in"
          type="text"
          maxlength="200"
          :value="(b.target as string) || ''"
          :placeholder="t('builder.customBlock.btnTargetPh')"
          @input="patch(i, 'target', ($event.target as HTMLInputElement).value)"
        />
        <p class="cb__hint">{{ t('builder.customBlock.btnTargetHint') }}</p>
        <div class="cb__chips">
          <button
            v-for="o in ['solid', 'ghost']"
            :key="o"
            type="button"
            class="chip"
            :class="{ 'is-on': (b.variant || 'solid') === o }"
            @click="patch(i, 'variant', o)"
          >
            {{ optLabel(o) }}
          </button>
        </div>
      </template>

      <!-- spacer -->
      <div v-else-if="b.kind === 'spacer'" class="cb__chips">
        <button
          v-for="o in ['sm', 'md', 'lg']"
          :key="o"
          type="button"
          class="chip"
          :class="{ 'is-on': (b.size || 'md') === o }"
          @click="patch(i, 'size', o)"
        >
          {{ optLabel(o) }}
        </button>
      </div>

      <!-- divider: nothing to configure -->
    </div>

    <div class="cb__pick">
      <span class="cb__pickK">{{ t('builder.customBlock.add') }}</span>
      <div class="cb__pickRow">
        <button
          v-for="k in KINDS"
          :key="k"
          type="button"
          class="cb__pickBtn"
          :disabled="blocks.length >= limit"
          @click="add(k)"
        >
          <v-icon :icon="KIND_ICON[k]" size="14" /> {{ kindLabel(k) }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cb {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.cb__card {
  padding: 0.6rem;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 9px;
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.cb__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.45rem;
}
.cb__kind {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.cb__acts {
  display: flex;
  gap: 0.1rem;
}
.cb__acts button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.cb__acts button:disabled {
  opacity: 0.3;
}
.cb__acts button:hover:not(:disabled) {
  background: rgba(var(--v-theme-on-surface), 0.08);
}
.cb__in {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border-radius: 8px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  color: inherit;
  font: inherit;
  font-size: 0.85rem;
  margin-bottom: 0.4rem;
}
.cb__in:focus {
  outline: 2px solid rgba(var(--v-theme-primary), 0.4);
  outline-offset: 1px;
}
.cb__area {
  resize: vertical;
  line-height: 1.45;
}
.cb__img {
  display: block;
  width: 100%;
  max-height: 120px;
  object-fit: cover;
  border-radius: 8px;
  margin-bottom: 0.4rem;
}
.cb__imgRow {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 0.4rem;
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
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.cb__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.chip {
  padding: 0.28rem 0.65rem;
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 600;
  border: 1px solid var(--tvz-glass-border);
  color: rgba(var(--v-theme-on-surface), 0.7);
  background: rgb(var(--v-theme-surface));
}
.chip.is-on {
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}
.cb__colorPick {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.28rem 0.6rem;
  border-radius: 999px;
  font-size: 0.74rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
  border: 1px solid var(--tvz-glass-border);
  cursor: pointer;
}
.cb__colorPick.is-set {
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-primary));
}
.cb__colorSw {
  width: 13px;
  height: 13px;
  border-radius: 4px;
  box-shadow: inset 0 0 0 1px rgba(var(--v-theme-on-surface), 0.25);
}
.cb__colorPick input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.cb__colorX {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.cb__hint {
  margin: -0.15rem 0 0.4rem;
  font-size: 0.7rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.cb__pick {
  margin-top: 0.2rem;
  padding-top: 0.5rem;
  border-top: 1px dashed var(--tvz-glass-border);
}
.cb__pickK {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.cb__pickRow {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.cb__pickBtn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.32rem 0.6rem;
  border-radius: 8px;
  font-size: 0.75rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  border: 1px dashed rgba(var(--v-theme-primary), 0.4);
}
.cb__pickBtn:disabled {
  opacity: 0.4;
  color: rgba(var(--v-theme-on-surface), 0.4);
  border-color: var(--tvz-glass-border);
}
</style>
