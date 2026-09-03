<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useBuilderStore, type SectionSpec } from '@/stores/builder'

const props = defineProps<{ companyId: string; pageId: string; index?: number }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const store = useBuilderStore()

const CATEGORY_ORDER = ['header', 'story', 'proof', 'offer', 'content', 'conversion']

const groups = computed(() => {
  const by: Record<string, SectionSpec[]> = {}
  for (const spec of store.catalog) (by[spec.category] ??= []).push(spec)
  return CATEGORY_ORDER.filter((c) => by[c]?.length).map((c) => ({ category: c, specs: by[c] }))
})

function label(spec: SectionSpec): string {
  const k = `catalog.${spec.label}.label`
  const s = t(k)
  return s === k ? spec.type : s
}
function desc(spec: SectionSpec): string {
  const k = `catalog.${spec.label}.desc`
  const s = t(k)
  return s === k ? '' : s
}
function catLabel(c: string): string {
  const k = `builder.cat.${c}`
  const s = t(k)
  return s === k ? c : s
}

async function pick(spec: SectionSpec): Promise<void> {
  await store.addSection(props.companyId, props.pageId, spec.type, undefined, props.index)
  emit('close')
}
</script>

<template>
  <div class="cat" role="dialog" aria-modal="true" @click.self="emit('close')">
    <div class="cat__panel">
      <header class="cat__head">
        <strong>{{ t('builder.addSection') }}</strong>
        <button type="button" class="cat__x" @click="emit('close')">
          <v-icon icon="mdi-close" size="20" />
        </button>
      </header>

      <div class="cat__body">
        <section v-for="g in groups" :key="g.category" class="cat__group">
          <h3>{{ catLabel(g.category) }}</h3>
          <div class="cat__grid">
            <button
              v-for="spec in g.specs"
              :key="spec.type"
              type="button"
              class="cat__card"
              @click="pick(spec)"
            >
              <span class="cat__ic"><v-icon :icon="spec.icon" size="20" /></span>
              <strong>{{ label(spec) }}</strong>
              <span v-if="desc(spec)" class="cat__d">{{ desc(spec) }}</span>
              <span v-if="spec.variants.length > 1" class="cat__v">
                {{ spec.variants.length }} {{ t('builder.variantsShort') }}
              </span>
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cat {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(0 0 0 / 0.45);
}
.cat__panel {
  width: min(760px, 100%);
  max-height: min(80vh, 720px);
  display: flex;
  flex-direction: column;
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--tvz-glass-border);
  box-shadow: var(--tvz-shadow-lg);
  overflow: hidden;
}
.cat__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1.1rem;
  border-bottom: 1px solid var(--tvz-hairline);
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1rem;
}
.cat__x {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.cat__body {
  overflow-y: auto;
  padding: 1rem 1.1rem 1.3rem;
}
.cat__group + .cat__group {
  margin-top: 1.2rem;
}
.cat__group h3 {
  margin: 0 0 0.5rem;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
.cat__grid {
  display: grid;
  gap: 0.6rem;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
}
.cat__card {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.8rem;
  text-align: left;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 11px;
  background: rgb(var(--v-theme-surface));
  transition:
    border-color 0.14s ease,
    background 0.14s ease,
    transform 0.14s ease;
}
.cat__card:hover {
  border-color: rgb(var(--v-theme-primary) / 0.5);
  background: rgb(var(--v-theme-primary) / 0.05);
  transform: translateY(-2px);
}
.cat__ic {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  margin-bottom: 0.35rem;
  color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary) / 0.12);
}
.cat__card strong {
  font-size: 0.9rem;
}
.cat__d {
  font-size: 0.75rem;
  line-height: 1.35;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.cat__v {
  margin-top: 0.3rem;
  font-size: 0.68rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.45);
}
</style>
