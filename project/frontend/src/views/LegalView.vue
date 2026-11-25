<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import { useSeo } from '@/composables/useSeo'
import { PRIVACY, TERMS } from '@/content/legal'

/** Privacy policy and terms (text in src/content/legal.ts). */
const { t } = useI18n()
const route = useRoute()
const kind = computed(() => (route.meta.legal === 'terms' ? 'terms' : 'privacy'))
const doc = computed(() => (kind.value === 'terms' ? TERMS : PRIVACY))
useSeo(() => ({
  title: t(`legal.${kind.value}.title`),
  canonicalPath: route.path,
  noindex: !doc.value.ready,
}))
const paragraphs = (body: string) => body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
</script>

<template>
  <v-container class="lg">
    <h1>{{ t(`legal.${kind}.title`) }}</h1>
    <p v-if="doc.ready && doc.updatedAt" class="lg__muted">{{ t('legal.updated', { date: doc.updatedAt }) }}</p>
    <p v-if="!doc.ready" class="lg__note">
      <v-icon icon="mdi-file-document-edit-outline" size="18" /> {{ t('legal.preparing') }}
    </p>
    <section v-for="s in doc.sections" :key="s.title" class="lg__s">
      <h2>{{ s.title }}</h2>
      <template v-if="s.body">
        <p v-for="(p, i) in paragraphs(s.body)" :key="i">{{ p }}</p>
      </template>
      <p v-else class="lg__muted">{{ s.covers }}</p>
    </section>
  </v-container>
</template>

<style scoped>
.lg {
  max-width: 760px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.lg h1 {
  margin-bottom: 0.5rem;
}
.lg__s {
  margin-top: 1.75rem;
}
.lg__s h2 {
  font-size: 1.15rem;
  margin-bottom: 0.4rem;
}
.lg__s p {
  margin: 0 0 0.75rem;
  line-height: 1.6;
  white-space: pre-line;
}
.lg__muted {
  color: rgba(var(--v-theme-on-surface), 0.62);
}
.lg__note {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.75rem 1rem;
  background: rgba(var(--v-theme-warning), 0.12);
}
</style>
