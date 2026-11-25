<script setup lang="ts">
/**
 * Prioritized issues, one line each (priority, title, badges). The
 * explanation (why it matters, what to do, Google source) opens on click,
 * so a long list stays scannable. Text comes from the backend evaluator.
 */
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import GaChip from './GaChip.vue'
import type { GoogleAdsIssue, IssuePriority } from '@/services/google-ads-optimization'

const props = defineProps<{
  issues: GoogleAdsIssue[]
  /** Start with every explanation open. */
  expanded?: boolean
}>()
const { t } = useI18n()

const open = ref<Set<number>>(new Set())
watch(
  () => props.issues.length,
  (n) => {
    if (props.expanded) open.value = new Set(Array.from({ length: n }, (_, i) => i))
  },
  { immediate: true },
)
function toggle(i: number) {
  if (open.value.has(i)) open.value.delete(i)
  else open.value.add(i)
}

const TONE: Record<IssuePriority, 'error' | 'warning' | 'primary' | 'neutral'> = {
  critical: 'error',
  high: 'warning',
  medium: 'primary',
  low: 'neutral',
}
</script>

<template>
  <p v-if="!issues.length" class="gil__none">
    <v-icon icon="mdi-check-circle-outline" size="16" color="success" />
    {{ t('adminGoogleAdsOpt.noIssues') }}
  </p>
  <ul v-else class="gil">
    <li
      v-for="(i, k) in issues"
      :key="k"
      class="gil__item"
      :class="{ 'gil__item--open': open.has(k) }"
    >
      <button type="button" class="gil__row" :aria-expanded="open.has(k)" @click="toggle(k)">
        <i
          class="gil__dot"
          :class="`gil__dot--${i.priority}`"
          :title="t(`adminGoogleAdsOpt.priority.${i.priority}`)"
        />
        <span class="gil__title">{{ i.title }}</span>
        <span class="gil__badges">
          <v-icon
            v-if="i.autoFixable"
            icon="mdi-robot-outline"
            size="15"
            class="gil__auto"
            :title="t('adminGoogleAdsOpt.autoFixBadge')"
          />
          <v-icon
            v-if="i.scope === 'account'"
            icon="mdi-domain"
            size="15"
            class="gil__acct"
            :title="t('adminGoogleAdsOpt.accountScope')"
          />
          <GaChip :tone="TONE[i.priority]">{{
            t(`adminGoogleAdsOpt.priority.${i.priority}`)
          }}</GaChip>
          <v-icon
            :icon="open.has(k) ? 'mdi-chevron-up' : 'mdi-chevron-down'"
            size="18"
            class="gil__chev"
          />
        </span>
      </button>
      <div v-if="open.has(k)" class="gil__body">
        <p>
          <span>{{ t('adminGoogleAdsOpt.whyLabel') }}</span
          >{{ i.why }}
        </p>
        <p>
          <span>{{ t('adminGoogleAdsOpt.actionLabel') }}</span
          >{{ i.action }}
        </p>
        <div class="gil__foot">
          <span v-if="i.autoFixable" class="gil__autoText">
            <v-icon icon="mdi-robot-outline" size="14" />{{ t('adminGoogleAdsOpt.autoFixBadge') }}
          </span>
          <a v-if="i.source" :href="i.source" target="_blank" rel="noopener noreferrer">
            {{ t('adminGoogleAdsOpt.sourceLink') }}<v-icon icon="mdi-open-in-new" size="12" />
          </a>
        </div>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.gil {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--tvz-glass-border, var(--tvz-hairline));
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}
.gil__item + .gil__item {
  border-top: 1px solid var(--tvz-hairline);
}
.gil__row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.6rem 0.85rem;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.gil__row:hover {
  background: rgba(var(--v-theme-on-surface), 0.025);
}
.gil__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.gil__dot--critical {
  background: rgb(var(--v-theme-error));
}
.gil__dot--high {
  background: rgb(var(--v-theme-warning));
}
.gil__dot--medium {
  background: rgb(var(--v-theme-primary));
}
.gil__dot--low {
  background: rgba(var(--v-theme-on-surface), 0.3);
}
.gil__title {
  flex: 1;
  min-width: 0;
  font-size: var(--tvz-fs-small);
  font-weight: 500;
  overflow-wrap: anywhere;
}
.gil__badges {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  flex: none;
}
.gil__auto {
  color: rgb(var(--v-theme-success));
}
.gil__acct,
.gil__chev {
  opacity: 0.5;
}
.gil__body {
  padding: 0 0.85rem 0.75rem 2.1rem;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.8);
}
.gil__body p {
  margin: 0 0 0.35rem;
  overflow-wrap: anywhere;
}
.gil__body p span {
  display: block;
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.gil__foot {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  font-size: var(--tvz-fs-caption);
}
.gil__foot a {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}
.gil__autoText {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: rgb(var(--v-theme-success));
}
.gil__none {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
@media (max-width: 600px) {
  .gil__badges .gac {
    display: none;
  }
}
</style>
