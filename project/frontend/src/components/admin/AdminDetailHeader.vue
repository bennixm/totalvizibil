<script setup lang="ts">
import { ref } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

defineProps<{
  backTo: RouteLocationRaw
  backLabel: string
  /** Short initials for the avatar tile. Omit to hide it. */
  avatar?: string
  title: string
  subtitle?: string
  /** Full id — shown truncated with a click-to-copy affordance. */
  id?: string
}>()

const copied = ref(false)
async function copyId(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* clipboard blocked */
  }
}
function short(v: string): string {
  return v.length > 16 ? `${v.slice(0, 8)}…${v.slice(-4)}` : v
}
</script>

<template>
  <div class="adh">
    <RouterLink :to="backTo" class="adh__back">
      <v-icon icon="mdi-arrow-left" size="15" />
      {{ backLabel }}
    </RouterLink>

    <div class="adh__bar">
      <span v-if="avatar" class="adh__av">{{ avatar }}</span>

      <div class="adh__id">
        <h1 class="adh__title">{{ title }}</h1>
        <div class="adh__sub">
          <span v-if="subtitle" class="adh__mail">{{ subtitle }}</span>
          <button v-if="id" type="button" class="adh__idbtn" @click="copyId(id)">
            <v-icon :icon="copied ? 'mdi-check' : 'mdi-content-copy'" size="12" />
            {{ short(id) }}
          </button>
        </div>
        <div v-if="$slots.pills" class="adh__pills"><slot name="pills" /></div>
      </div>

      <div v-if="$slots.actions" class="adh__actions"><slot name="actions" /></div>
    </div>

    <div v-if="$slots.meta" class="adh__meta"><slot name="meta" /></div>
  </div>
</template>

<style scoped>
.adh {
  margin-bottom: 1.4rem;
}
.adh__back {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.55);
  text-decoration: none;
  margin-bottom: 1rem;
}
.adh__back:hover {
  color: rgb(var(--v-theme-primary));
}
.adh__bar {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  flex-wrap: wrap;
}
.adh__av {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  flex: none;
  border-radius: 14px;
  font-size: 1rem;
  font-weight: 700;
  color: #fff;
  background: var(--tvz-gradient-brand, linear-gradient(115deg, #3f63e8, #6d5ef0));
}
.adh__id {
  flex: 1;
  min-width: 0;
}
.adh__title {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.35rem, 3vw, 1.75rem);
  letter-spacing: -0.02em;
  line-height: 1.1;
  margin: 0;
}
.adh__sub {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-top: 0.3rem;
}
.adh__mail {
  font-size: 0.88rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.adh__idbtn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.72rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: rgb(var(--v-theme-on-surface) / 0.45);
  padding: 0.1rem 0.4rem;
  border-radius: 6px;
  border: 1px solid var(--tvz-hairline);
  transition: color 0.14s ease, border-color 0.14s ease;
}
.adh__idbtn:hover {
  color: rgb(var(--v-theme-primary));
  border-color: rgb(var(--v-theme-primary) / 0.4);
}
.adh__pills {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-top: 0.6rem;
}
.adh__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.adh__meta {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  flex-wrap: wrap;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--tvz-hairline);
}
</style>
