<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'

import { useBuilderStore } from '@/stores/builder'
import { PRESET_IDS, PALETTE_HEX, STYLE_PRESETS } from '@/components/builder/style-presets'
import type { WebsiteTheme, ThemePalette, ThemeRadius, ThemeFont } from '@/types/website'

const props = defineProps<{ companyId: string }>()
const emit = defineEmits<{ openAi: [] }>()
const { t } = useI18n()
const store = useBuilderStore()
const { doc, view, working } = storeToRefs(store)

const PALETTES = Object.keys(PALETTE_HEX) as ThemePalette[]
const FONTS: ThemeFont[] = ['grotesk', 'inter', 'fraunces', 'jetbrains']
const RADII: ThemeRadius[] = ['none', 'subtle', 'rounded', 'large', 'pill']
const BACKGROUNDS = ['light', 'tinted', 'dark'] as const
const BTN_STYLES = ['solid', 'outline', 'soft', 'pill'] as const
const SHADOWS = ['none', 'soft', 'bold'] as const
const DENSITIES = ['compact', 'comfortable', 'spacious'] as const

const DEFAULT: WebsiteTheme = {
  palette: 'indigo',
  fontPair: 'grotesk-inter',
  radius: 'rounded',
  density: 'comfortable',
}
const theme = computed<WebsiteTheme>(() => doc.value?.theme ?? DEFAULT)
const accent = computed(() => theme.value.accent ?? '')
const open = ref(false)

function patch(p: Partial<WebsiteTheme>): void {
  // any manual tweak detaches from the named preset
  void store.patchTheme(props.companyId, { ...p, preset: undefined })
}
function presetHex(id: string): string {
  const p = STYLE_PRESETS[id as keyof typeof STYLE_PRESETS]
  return PALETTE_HEX[(p?.palette ?? 'indigo') as ThemePalette]
}
function tl(key: string, raw: string): string {
  const s = t(key)
  return s === key ? raw : s
}
</script>

<template>
  <div class="tb">
    <div class="tb__row">
      <span class="tb__k">{{ t('builder.presetLabel') }}</span>
      <div class="tb__presets">
        <button
          v-for="id in PRESET_IDS"
          :key="id"
          type="button"
          class="tb__preset"
          :class="{ 'is-on': theme.preset === id }"
          :style="{ '--sw': presetHex(id) }"
          @click="store.applyPreset(companyId, id)"
        >
          <span class="tb__presetDot" />
          {{ tl(`builder.preset.${id}`, id) }}
        </button>
      </div>

      <div class="tb__aiGrp">
        <button
          v-if="view?.aiCanUndo"
          type="button"
          class="tb__undo"
          :disabled="working"
          @click="store.aiUndo(props.companyId)"
        >
          <v-icon icon="mdi-undo-variant" size="15" /> {{ t('builder.aiUndo') }}
        </button>
        <button type="button" class="tb__ai" :disabled="working" @click="emit('openAi')">
          <v-icon icon="mdi-creation" size="15" /> {{ t('builder.generateAi') }}
        </button>
      </div>

      <button type="button" class="tb__more" :class="{ 'is-on': open }" @click="open = !open">
        <v-icon :icon="open ? 'mdi-chevron-up' : 'mdi-tune-vertical'" size="16" />
        {{ t('builder.fineTune') }}
      </button>
    </div>

    <div v-if="open" class="tb__panel">
      <div class="tb__grp">
        <span class="tb__k">{{ t('builder.background') }}</span>
        <div class="tb__seg">
          <button
            v-for="b in BACKGROUNDS"
            :key="b"
            type="button"
            :class="{ 'is-on': (theme.background || 'light') === b }"
            @click="patch({ background: b })"
          >
            {{ tl(`builder.bg.${b}`, b) }}
          </button>
        </div>
      </div>

      <div class="tb__grp tb__grp--wide">
        <span class="tb__k">{{ t('builder.palette') }}</span>
        <button
          v-for="p in PALETTES"
          :key="p"
          type="button"
          class="tb__sw"
          :class="{ 'is-on': !accent && theme.palette === p }"
          :style="{ '--sw': PALETTE_HEX[p] }"
          :title="p"
          @click="patch({ palette: p, accent: '' })"
        />
        <label class="tb__sw tb__sw--c" :style="{ '--sw': accent || '#888' }" :title="t('builder.customColor')">
          <v-icon icon="mdi-eyedropper-variant" size="13" />
          <input type="color" :value="accent || '#4f46e5'" @input="patch({ accent: ($event.target as HTMLInputElement).value })" />
        </label>
        <button v-if="accent" type="button" class="tb__clear" @click="patch({ accent: '' })">
          <v-icon icon="mdi-close" size="13" />
        </button>
      </div>

      <div class="tb__grp">
        <span class="tb__k">{{ t('builder.headingFontLabel') }}</span>
        <select :value="theme.headingFont ?? 'grotesk'" @change="patch({ headingFont: ($event.target as HTMLSelectElement).value as ThemeFont })">
          <option v-for="f in FONTS" :key="f" :value="f">{{ tl(`builder.font.${f}`, f) }}</option>
        </select>
      </div>
      <div class="tb__grp">
        <span class="tb__k">{{ t('builder.bodyFontLabel') }}</span>
        <select :value="theme.bodyFont ?? 'inter'" @change="patch({ bodyFont: ($event.target as HTMLSelectElement).value as ThemeFont })">
          <option v-for="f in ['inter', 'grotesk']" :key="f" :value="f">{{ tl(`builder.font.${f}`, f) }}</option>
        </select>
      </div>

      <div class="tb__grp">
        <span class="tb__k">{{ t('builder.radiusLabel') }}</span>
        <div class="tb__seg">
          <button
            v-for="r in RADII"
            :key="r"
            type="button"
            :class="{ 'is-on': theme.radius === r }"
            @click="patch({ radius: r })"
          >
            {{ tl(`builder.radius.${r}`, r) }}
          </button>
        </div>
      </div>

      <div class="tb__grp">
        <span class="tb__k">{{ t('builder.btnStyleLabel') }}</span>
        <div class="tb__seg">
          <button
            v-for="b in BTN_STYLES"
            :key="b"
            type="button"
            :class="{ 'is-on': (theme.buttonStyle || 'solid') === b }"
            @click="patch({ buttonStyle: b })"
          >
            {{ tl(`builder.btn.${b}`, b) }}
          </button>
        </div>
      </div>

      <div class="tb__grp">
        <span class="tb__k">{{ t('builder.shadowLabel') }}</span>
        <div class="tb__seg">
          <button
            v-for="s in SHADOWS"
            :key="s"
            type="button"
            :class="{ 'is-on': (theme.shadow || 'soft') === s }"
            @click="patch({ shadow: s })"
          >
            {{ tl(`builder.shadow.${s}`, s) }}
          </button>
        </div>
      </div>

      <div class="tb__grp">
        <span class="tb__k">{{ t('builder.densityLabel') }}</span>
        <div class="tb__seg">
          <button
            v-for="d in DENSITIES"
            :key="d"
            type="button"
            :class="{ 'is-on': theme.density === d }"
            @click="patch({ density: d })"
          >
            {{ t(`builder.density.${d}`) }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tb {
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
}
.tb__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.9rem;
  padding: 0.55rem 0.8rem;
}
.tb__k {
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
.tb__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.tb__preset {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.32rem 0.7rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
  border: 1px solid var(--tvz-glass-border);
  color: rgb(var(--v-theme-on-surface) / 0.75);
  background: rgb(var(--v-theme-surface));
}
.tb__preset.is-on {
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary) / 0.08);
}
.tb__presetDot {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  background: var(--sw);
}
.tb__aiGrp {
  margin-left: auto;
  display: flex;
  gap: 0.4rem;
}
.tb__ai {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.85rem;
  border-radius: 8px;
  font-size: 0.78rem;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(120deg, rgb(var(--v-theme-primary)), var(--tvz-ai, #7c5cff));
}
.tb__undo {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.4rem 0.7rem;
  border-radius: 8px;
  font-size: 0.76rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.7);
  border: 1px solid var(--tvz-glass-border);
}
.tb__ai:disabled,
.tb__undo:disabled {
  opacity: 0.55;
}
.tb__more {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.4rem 0.75rem;
  border-radius: 8px;
  font-size: 0.76rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.65);
  border: 1px solid var(--tvz-glass-border);
}
.tb__more.is-on {
  color: rgb(var(--v-theme-primary));
  border-color: rgb(var(--v-theme-primary) / 0.4);
}

.tb__panel {
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem 1.4rem;
  padding: 0.8rem;
  border-top: 1px solid var(--tvz-hairline);
}
.tb__grp {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.tb__grp--wide {
  flex-wrap: wrap;
}
.tb__seg {
  display: inline-flex;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 8px;
  overflow: hidden;
}
.tb__seg button {
  padding: 0.3rem 0.6rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.6);
  background: rgb(var(--v-theme-surface));
}
.tb__seg button + button {
  border-left: 1px solid var(--tvz-glass-border);
}
.tb__seg button.is-on {
  color: #fff;
  background: rgb(var(--v-theme-primary));
}
.tb__sw {
  --sw: #4f46e5;
  position: relative;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  background: var(--sw);
  border: 2px solid rgb(var(--v-theme-surface));
  box-shadow: 0 0 0 1px rgb(var(--v-theme-on-surface) / 0.15);
  cursor: pointer;
  display: grid;
  place-items: center;
  color: #fff;
}
.tb__sw.is-on {
  box-shadow:
    0 0 0 2px rgb(var(--v-theme-surface)),
    0 0 0 4px var(--sw);
}
.tb__sw--c {
  overflow: hidden;
}
.tb__sw--c input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.tb__clear {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.tb select {
  padding: 0.3rem 0.4rem;
  border-radius: 7px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  color: inherit;
  font: inherit;
  font-size: 0.78rem;
}
</style>
