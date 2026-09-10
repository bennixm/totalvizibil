<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import SectionField from '@/components/builder/SectionField.vue'
import { useBuilderStore } from '@/stores/builder'

const props = defineProps<{ companyId: string }>()
const { t } = useI18n()
const store = useBuilderStore()
const { selectedSection, selectedSpec, working, view } = storeToRefs(store)

const ANIM_FALLBACK = ['none', 'fade', 'rise', 'slideLeft', 'slideRight', 'zoom', 'blur']
// "auto" = clear the per-section override and follow the site's motion setting.
const animOptions = computed<string[]>(() => [
  'auto',
  ...(view.value?.animations ?? ANIM_FALLBACK.map((id) => ({ id, label: id }))).map((a) =>
    typeof a === 'string' ? a : a.id,
  ),
])
const currentAnim = computed(() => selectedSection.value?.animation || 'auto')
function setAnim(id: string): void {
  if (!selectedSection.value) return
  store.patchSection(props.companyId, selectedSection.value.id, {
    animation: id === 'auto' ? '' : id,
  })
}
function animLabel(id: string): string {
  const k = `catalog.anim.${id}`
  const s = t(k)
  return s === k ? id : s
}

const tweak = ref('')
async function runTweak(): Promise<void> {
  const ins = tweak.value.trim()
  if (ins.length < 3 || !selectedSection.value || working.value) return
  const ok = await store.aiSection(props.companyId, selectedSection.value.id, ins)
  if (ok) tweak.value = ''
}

const typeLabel = computed(() => {
  const spec = selectedSpec.value
  if (!spec) return ''
  const k = `catalog.${spec.label}.label`
  const s = t(k)
  return s === k ? spec.type : s
})

function setVariant(id: string): void {
  if (selectedSection.value) {
    store.patchSection(props.companyId, selectedSection.value.id, { variant: id })
  }
}
function setField(key: string, value: unknown): void {
  if (selectedSection.value) {
    store.patchSection(props.companyId, selectedSection.value.id, { content: { [key]: value } })
  }
}
function variantLabel(id: string): string {
  const k = `catalog.variant.${id}`
  const s = t(k)
  return s === k ? id : s
}

// --- per-section colour overrides ---
const COLOR_KEYS = ['bg', 'text', 'heading', 'accent'] as const
type ColorKey = (typeof COLOR_KEYS)[number]
function colorOf(key: ColorKey): string {
  return (selectedSection.value?.style?.[key] as string) || ''
}
function setColor(key: ColorKey, value: string): void {
  if (selectedSection.value) {
    store.patchSection(props.companyId, selectedSection.value.id, { style: { [key]: value } })
  }
}

// --- per-element style overrides ---
const PROSE_TYPES = new Set(['text', 'textarea', 'richtext'])
const elFields = computed(() =>
  (selectedSpec.value?.fields ?? []).filter((f) => PROSE_TYPES.has(f.type)),
)
const EL_SIZES = ['sm', 'md', 'lg', 'xl'] as const
const EL_WEIGHTS = ['normal', 'medium', 'semibold', 'bold'] as const
const EL_ALIGNS = ['left', 'center', 'right'] as const
type ElVal = { color?: string; bg?: string; size?: string; weight?: string; align?: string }
function elOf(key: string): ElVal {
  return (selectedSection.value?.overrides?.[key] as ElVal) ?? {}
}
function elHas(key: string): boolean {
  return Object.keys(elOf(key)).length > 0
}
function setEl(key: string, patch: Record<string, string | undefined>): void {
  if (selectedSection.value) {
    store.patchSection(props.companyId, selectedSection.value.id, { overrides: { [key]: patch } })
  }
}
function clearEl(key: string): void {
  if (selectedSection.value) {
    store.patchSection(props.companyId, selectedSection.value.id, { overrides: { [key]: null } })
  }
}
function fieldLabel(label: string, key: string): string {
  const k = `builder.field.${label}`
  const s = t(k)
  return s === k ? key : s
}
</script>

<template>
  <div class="se">
    <div v-if="!selectedSection || !selectedSpec" class="se__empty">
      <v-icon icon="mdi-cursor-default-click-outline" size="26" />
      <p>{{ t('builder.editorEmpty') }}</p>
    </div>

    <template v-else>
      <header class="se__head">
        <v-icon :icon="selectedSpec.icon" size="18" />
        <strong>{{ typeLabel }}</strong>
      </header>

      <div v-if="selectedSpec.variants.length > 1" class="se__block">
        <span class="se__k">{{ t('builder.variant') }}</span>
        <div class="se__chips">
          <button
            v-for="v in selectedSpec.variants"
            :key="v.id"
            type="button"
            class="chip"
            :class="{ 'is-on': (selectedSection.variant || selectedSpec.variants[0].id) === v.id }"
            @click="setVariant(v.id)"
          >
            {{ variantLabel(v.id) }}
          </button>
        </div>
      </div>

      <div class="se__block">
        <span class="se__k"><v-icon icon="mdi-motion-outline" size="13" /> {{ t('builder.animation') }}</span>
        <div class="se__chips">
          <button
            v-for="a in animOptions"
            :key="a"
            type="button"
            class="chip"
            :class="{ 'is-on': currentAnim === a }"
            @click="setAnim(a)"
          >
            {{ animLabel(a) }}
          </button>
        </div>
      </div>

      <div class="se__block">
        <span class="se__k"><v-icon icon="mdi-palette-outline" size="13" /> {{ t('builder.sectionColors') }}</span>
        <div class="se__colors">
          <span
            v-for="k in COLOR_KEYS"
            :key="k"
            class="se__color"
            :class="{ 'is-set': !!colorOf(k) }"
          >
            <span class="se__colorSw" :style="{ background: colorOf(k) || 'transparent' }" />
            <span class="se__colorK">{{ t(`builder.color.${k}`) }}</span>
            <input
              type="color"
              :value="colorOf(k) || '#111111'"
              @input="setColor(k, ($event.target as HTMLInputElement).value)"
            />
            <button
              v-if="colorOf(k)"
              type="button"
              class="se__colorX"
              :title="t('builder.color.clear')"
              @click="setColor(k, '')"
            >
              <v-icon icon="mdi-close" size="11" />
            </button>
          </span>
        </div>
      </div>

      <div v-if="elFields.length" class="se__block">
        <span class="se__k">
          <v-icon icon="mdi-format-color-text" size="13" /> {{ t('builder.elementStyles') }}
        </span>
        <details
          v-for="f in elFields"
          :key="f.key"
          class="se__el"
          :class="{ 'is-set': elHas(f.key) }"
        >
          <summary>
            {{ fieldLabel(f.label, f.key) }}
            <span v-if="elHas(f.key)" class="se__elDot" />
          </summary>
          <div class="se__elBody">
            <label class="se__elRow">
              <span>{{ t('builder.color.text') }}</span>
              <input
                type="color"
                :value="elOf(f.key).color || '#111111'"
                @input="setEl(f.key, { color: ($event.target as HTMLInputElement).value })"
              />
              <button
                v-if="elOf(f.key).color"
                type="button"
                class="se__colorX"
                @click="setEl(f.key, { color: '' })"
              >
                <v-icon icon="mdi-close" size="11" />
              </button>
            </label>
            <label class="se__elRow">
              <span>{{ t('builder.elBg') }}</span>
              <input
                type="color"
                :value="elOf(f.key).bg || '#ffffff'"
                @input="setEl(f.key, { bg: ($event.target as HTMLInputElement).value })"
              />
              <button
                v-if="elOf(f.key).bg"
                type="button"
                class="se__colorX"
                @click="setEl(f.key, { bg: '' })"
              >
                <v-icon icon="mdi-close" size="11" />
              </button>
            </label>
            <div class="se__elSeg">
              <button
                v-for="sz in EL_SIZES"
                :key="sz"
                type="button"
                :class="{ 'is-on': elOf(f.key).size === sz }"
                @click="setEl(f.key, { size: elOf(f.key).size === sz ? '' : sz })"
              >
                {{ t(`builder.elSize.${sz}`) }}
              </button>
            </div>
            <div class="se__elSeg">
              <button
                v-for="w in EL_WEIGHTS"
                :key="w"
                type="button"
                :class="{ 'is-on': elOf(f.key).weight === w }"
                @click="setEl(f.key, { weight: elOf(f.key).weight === w ? '' : w })"
              >
                {{ t(`builder.elWeight.${w}`) }}
              </button>
            </div>
            <div class="se__elSeg">
              <button
                v-for="a in EL_ALIGNS"
                :key="a"
                type="button"
                :class="{ 'is-on': elOf(f.key).align === a }"
                @click="setEl(f.key, { align: elOf(f.key).align === a ? '' : a })"
              >
                <v-icon :icon="`mdi-format-align-${a}`" size="14" />
              </button>
            </div>
            <button v-if="elHas(f.key)" type="button" class="se__elClear" @click="clearEl(f.key)">
              {{ t('builder.color.clear') }}
            </button>
          </div>
        </details>
      </div>

      <div class="se__block">
        <SectionField
          v-for="f in selectedSpec.fields"
          :key="f.key"
          :spec="f"
          :company-id="companyId"
          :model-value="selectedSection.content[f.key]"
          @update:model-value="setField(f.key, $event)"
        />
      </div>

      <div class="se__ai">
        <span class="se__k"><v-icon icon="mdi-creation" size="13" /> {{ t('builder.aiTweak') }}</span>
        <div class="se__aiRow">
          <input
            v-model="tweak"
            class="se__aiIn"
            type="text"
            maxlength="600"
            :placeholder="t('builder.aiTweakPh')"
            @keydown.enter="runTweak"
          />
          <button type="button" class="se__aiGo" :disabled="working || tweak.trim().length < 3" @click="runTweak">
            <v-progress-circular v-if="working" indeterminate size="14" width="2" />
            <v-icon v-else icon="mdi-arrow-up" size="16" />
          </button>
        </div>
        <p v-if="view && !view.aiConfigured" class="se__aiNote">{{ t('builder.aiNoKey') }}</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.se {
  height: 100%;
  overflow-y: auto;
  padding: 0.9rem;
}
.se__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 3rem 1rem;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.85rem;
}
.se__head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding-bottom: 0.7rem;
  margin-bottom: 0.7rem;
  border-bottom: 1px solid var(--tvz-hairline);
  font-family: 'Space Grotesk Variable', sans-serif;
}
.se__block {
  margin-bottom: 1rem;
}
.se__k {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.se__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.se__colors {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.se__color {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.28rem 0.55rem;
  border-radius: 8px;
  font-size: 0.74rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.65);
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  cursor: pointer;
}
.se__color.is-set {
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-primary));
}
.se__colorSw {
  width: 13px;
  height: 13px;
  border-radius: 4px;
  box-shadow: inset 0 0 0 1px rgba(var(--v-theme-on-surface), 0.25);
}
.se__color input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.se__colorX {
  z-index: 1;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 5px;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* --- per-element style overrides --- */
.se__el {
  border: 1px solid var(--tvz-glass-border);
  border-radius: 8px;
  margin-bottom: 0.35rem;
  background: rgb(var(--v-theme-surface));
}
.se__el > summary {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.6rem;
  font-size: 0.76rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer;
  list-style: none;
}
.se__el > summary::-webkit-details-marker {
  display: none;
}
.se__el.is-set > summary {
  color: rgb(var(--v-theme-primary));
}
.se__elDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
}
.se__elBody {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0 0.6rem 0.55rem;
}
.se__elRow {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.74rem;
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.se__elRow span {
  flex: 1;
}
.se__elRow input[type='color'] {
  width: 26px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 5px;
  background: none;
  cursor: pointer;
}
.se__elSeg {
  display: flex;
  gap: 2px;
}
.se__elSeg button {
  flex: 1;
  padding: 0.28rem 0;
  font-size: 0.68rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
}
.se__elSeg button:first-child {
  border-radius: 6px 0 0 6px;
}
.se__elSeg button:last-child {
  border-radius: 0 6px 6px 0;
}
.se__elSeg button.is-on {
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}
.se__elClear {
  align-self: flex-start;
  font-size: 0.7rem;
  color: rgb(var(--v-theme-error));
  text-decoration: underline;
}
.chip {
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  font-size: 0.78rem;
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
.se__ai {
  margin-top: 0.6rem;
  padding-top: 0.8rem;
  border-top: 1px solid var(--tvz-hairline);
}
.se__ai .se__k {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.se__aiRow {
  display: flex;
  gap: 0.4rem;
}
.se__aiIn {
  flex: 1;
  min-width: 0;
  padding: 0.5rem 0.65rem;
  border-radius: 8px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  color: inherit;
  font: inherit;
  font-size: 0.84rem;
}
.se__aiGo {
  display: grid;
  place-items: center;
  width: 34px;
  border-radius: 8px;
  color: #fff;
  background: rgb(var(--v-theme-primary));
}
.se__aiGo:disabled {
  opacity: 0.5;
}
.se__aiNote {
  margin: 0.4rem 0 0;
  font-size: 0.72rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
</style>
