<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { UserAction } from '@/services/googleAdsUser'
import { adsMoney } from './format'

/** Exactly what an action changes, line by line (added / removed). */
const props = defineProps<{ action: UserAction; currency: string | null | undefined }>()
const { t, locale } = useI18n()

interface Line {
  sign: '+' | '-'
  text: string
  note?: string
}
interface Keyword {
  text: string
  matchType?: string
}
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

const lines = computed<Line[]>(() => {
  const before = obj(props.action.before)
  const after = obj(props.action.after)
  switch (props.action.action) {
    case 'chat.ad_texts': {
      return (['headlines', 'descriptions'] as const).flatMap((k) => {
        const b = arr<{ text: string }>(before[k]).map((x) => x.text)
        const a = arr<{ text: string }>(after[k]).map((x) => x.text)
        const note = t(`ads.element.${k}`)
        return [
          ...b.filter((x) => !a.includes(x)).map((text): Line => ({ sign: '-', text, note })),
          ...a.filter((x) => !b.includes(x)).map((text): Line => ({ sign: '+', text, note })),
        ]
      })
    }
    case 'chat.ad_create':
      return [
        { sign: '+', text: String(after.finalUrl ?? ''), note: t('ads.chat.change.page') },
        ...(['headlines', 'descriptions'] as const).flatMap((k) =>
          arr<string>(after[k]).map((text): Line => ({ sign: '+', text, note: t(`ads.element.${k}`) })),
        ),
      ]
    case 'chat.keywords': {
      const kw = (v: unknown, note: string) =>
        arr<Keyword>(v).map(
          (k): Line => ({ sign: '+', text: k.text, note: `${note}, ${t(`ads.chat.match.${k.matchType}`)}` }),
        )
      return [
        ...kw(after.add, t('ads.chat.change.keyword')),
        ...kw(after.negatives, t('ads.chat.change.negative')),
        ...arr<Keyword>(after.pause).map((k): Line => ({ sign: '-', text: k.text, note: t('ads.chat.change.paused') })),
      ]
    }
    case 'chat.extensions':
      return [
        ...arr<{ linkText: string; url: string }>(after.sitelinks).map(
          (s): Line => ({ sign: '+', text: `${s.linkText} (${s.url})`, note: 'Sitelink' }),
        ),
        ...arr<string>(after.callouts).map((text): Line => ({ sign: '+', text, note: 'Callout' })),
      ]
    case 'chat.status':
      return [
        { sign: '-', text: t(`ads.status.${before.status}`, String(before.status)) },
        { sign: '+', text: t(`ads.status.${after.status}`, String(after.status)) },
      ]
    case 'budget.change.proposed':
      return [
        { sign: '-', text: adsMoney(before.amountMicros as string, props.currency, locale.value), note: t('ads.chat.change.daily') },
        { sign: '+', text: adsMoney(after.amountMicros as string, props.currency, locale.value), note: t('ads.chat.change.daily') },
      ]
    default:
      return [
        { sign: '-', text: String(before.text ?? '') },
        { sign: '+', text: String(after.text ?? '') },
      ]
  }
})
</script>

<template>
  <ul class="cp">
    <li v-for="(l, i) in lines" :key="i" :class="l.sign === '+' ? 'is-add' : 'is-del'">
      <span class="cp__sign" aria-hidden="true">{{ l.sign === '+' ? '+' : '−' }}</span>
      <span class="cp__text">{{ l.text }}</span>
      <span v-if="l.note" class="cp__note">{{ l.note }}</span>
    </li>
  </ul>
</template>

<style scoped>
.cp {
  list-style: none;
  margin: 0;
  padding: 0.5rem 0.75rem;
  border-radius: var(--tvz-radius-md);
  background: rgba(var(--v-theme-on-surface), 0.04);
  font-size: var(--tvz-fs-small);
}
.cp li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.1rem 0.5rem;
  padding: 0.2rem 0;
}
.cp__sign {
  width: 0.8rem;
  font-weight: 700;
}
.cp__text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.cp__note {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.is-add .cp__sign {
  color: rgb(var(--v-theme-success));
}
.is-del .cp__sign {
  color: rgb(var(--v-theme-error));
}
.is-del .cp__text {
  text-decoration: line-through;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
</style>
