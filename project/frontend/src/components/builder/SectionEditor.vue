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
  color: rgb(var(--v-theme-on-surface) / 0.5);
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
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.se__chips {
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
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
</style>
