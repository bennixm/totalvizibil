<script setup lang="ts">
import { uiLocale } from '@/plugins/i18n'
/**
 * The agent's live activity feed. Every row is a real step the backend
 * recorded (GoogleAdsAgentEvent); nothing here is simulated. Polls
 * incrementally (`after` = last server time) — every 2.5 s while the agent
 * is running or a step is still in progress, every 20 s otherwise — and
 * merges changed rows by id, so a step visibly goes from "running" to its
 * result as it happens.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import GaChip from './GaChip.vue'
import {
  googleAdsOptimizationApi,
  type AgentEventStatus,
  type GoogleAdsAgentEvent,
} from '@/services/google-ads-optimization'

const props = withDefaults(
  defineProps<{
    googleCampaignId?: string
    limit?: number
    compact?: boolean
    hideCampaign?: boolean
    /** Another event source with the same response shape (a customer's
     *  campaign in the Google Ads optimization builder). Default: the
     *  platform agent's admin feed. */
    loader?: (
      after?: string,
    ) => Promise<{ events: GoogleAdsAgentEvent[]; running: boolean; serverTime: string }>
  }>(),
  { limit: 150, compact: false, hideCampaign: false },
)
const emit = defineEmits<{ (e: 'running', value: boolean): void }>()
const { t } = useI18n()

const events = ref<GoogleAdsAgentEvent[]>([])
const running = ref(false)
const loading = ref(true)
const onlyProblems = ref(false)
/** Rows whose full result text is expanded. */
const expanded = ref<Set<string>>(new Set())
function toggle(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
}
let serverTime: string | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let stopped = false

const STATUS: Record<
  AgentEventStatus,
  { tone: 'primary' | 'success' | 'error' | 'warning' | 'neutral'; icon: string }
> = {
  running: { tone: 'primary', icon: 'mdi-progress-clock' },
  completed: { tone: 'success', icon: 'mdi-check' },
  failed: { tone: 'error', icon: 'mdi-close' },
  waiting_approval: { tone: 'warning', icon: 'mdi-account-clock-outline' },
  skipped: { tone: 'neutral', icon: 'mdi-skip-next' },
}

const STEP_ICON: Record<string, string> = {
  cycle: 'mdi-sync',
  sync: 'mdi-cloud-download-outline',
  urls: 'mdi-link-variant',
  performance: 'mdi-chart-line',
  headlines: 'mdi-format-title',
  keywords: 'mdi-key-variant',
  assets: 'mdi-link-box-variant-outline',
  images: 'mdi-image-outline',
  videos: 'mdi-video-outline',
  logos: 'mdi-shield-star-outline',
  policy: 'mdi-shield-check-outline',
  policy_fix: 'mdi-shield-edit-outline',
  score: 'mdi-gauge',
  rescore: 'mdi-gauge',
  prioritize: 'mdi-sort-descending',
  optimize: 'mdi-auto-fix',
  generate: 'mdi-creation-outline',
  validate_local: 'mdi-check-decagram-outline',
  validate_google: 'mdi-google',
  apply: 'mdi-upload-outline',
  verify: 'mdi-magnify-scan',
  analyze: 'mdi-gauge',
  budget: 'mdi-cash-sync',
  environment: 'mdi-shield-lock-outline',
  schedule: 'mdi-calendar-clock',
}

const shown = computed(() =>
  onlyProblems.value
    ? events.value.filter(
        (e) => e.status === 'failed' || e.status === 'waiting_approval' || e.status === 'skipped',
      )
    : events.value,
)
const anyRunning = computed(() => running.value || events.value.some((e) => e.status === 'running'))

function merge(incoming: GoogleAdsAgentEvent[]) {
  const byId = new Map(events.value.map((e) => [e.id, e]))
  for (const e of incoming) byId.set(e.id, e)
  events.value = [...byId.values()]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, props.limit)
}

async function poll(initial = false) {
  try {
    const after = initial ? undefined : serverTime
    const res = props.loader
      ? await props.loader(after)
      : await googleAdsOptimizationApi.activity({
          googleCampaignId: props.googleCampaignId,
          limit: props.limit,
          after,
        })
    if (initial) events.value = res.events
    else merge(res.events)
    serverTime = res.serverTime
    running.value = res.running
    emit('running', res.running)
  } catch {
    /* transient; next poll retries */
  } finally {
    loading.value = false
    schedule()
  }
}

function schedule() {
  if (stopped) return
  clearTimeout(timer)
  timer = setTimeout(() => void poll(), anyRunning.value ? 2500 : 20000)
}

/** Lets the parent ask for an immediate refresh (e.g. right after "Run now"). */
function refresh() {
  clearTimeout(timer)
  void poll()
}
defineExpose({ refresh })

onMounted(() => void poll(true))
onBeforeUnmount(() => {
  stopped = true
  clearTimeout(timer)
})
watch(
  () => props.googleCampaignId,
  () => {
    serverTime = undefined
    loading.value = true
    clearTimeout(timer)
    void poll(true)
  },
)

function time(iso: string) {
  return new Date(iso).toLocaleTimeString(uiLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
function day(iso: string) {
  return new Date(iso).toLocaleDateString(uiLocale(), { day: '2-digit', month: '2-digit' })
}
function duration(e: GoogleAdsAgentEvent) {
  if (!e.finishedAt) return ''
  const ms = new Date(e.finishedAt).getTime() - new Date(e.startedAt).getTime()
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : ''
}
</script>

<template>
  <div class="gaf" :class="{ 'gaf--compact': compact }">
    <div v-if="!compact" class="gaf__bar">
      <span class="gaf__live" :class="{ 'gaf__live--on': anyRunning }">
        <span class="gaf__dot" />
        {{ anyRunning ? t('adminGoogleAdsOpt.running') : t('adminGoogleAdsOpt.idle') }}
      </span>
      <v-spacer />
      <v-switch
        v-model="onlyProblems"
        :label="t('adminGoogleAdsOpt.activityOnlyIssues')"
        density="compact"
        hide-details
        color="primary"
        class="gaf__filter"
      />
    </div>

    <div v-if="loading" class="d-flex justify-center py-8">
      <v-progress-circular indeterminate color="primary" size="28" />
    </div>
    <p v-else-if="!shown.length" class="gaf__empty">{{ t('adminGoogleAdsOpt.activityEmpty') }}</p>
    <TransitionGroup v-else tag="ol" name="gaf-row" class="gaf__list">
      <li
        v-for="e in shown"
        :key="e.id"
        class="gaf__row"
        :class="[`gaf__row--${e.status}`, { 'gaf__row--open': expanded.has(e.id) }]"
        @click="e.result && toggle(e.id)"
      >
        <time class="gaf__time" :title="`${day(e.startedAt)} ${time(e.startedAt)}`">
          {{ time(e.startedAt).slice(0, 5) }}
        </time>
        <span class="gaf__icon">
          <v-progress-circular
            v-if="e.status === 'running'"
            indeterminate
            size="14"
            width="2"
            color="primary"
          />
          <v-icon v-else :icon="STEP_ICON[e.step] ?? 'mdi-circle-small'" size="16" />
        </span>
        <div class="gaf__main">
          <div class="gaf__head">
            <span class="gaf__msg">{{ e.message }}</span>
            <RouterLink
              v-if="e.googleCampaignId && e.campaignName && !hideCampaign"
              :to="{
                name: 'admin-google-ads-campaign',
                params: { googleCampaignId: e.googleCampaignId },
              }"
              class="gaf__camp"
              @click.stop
            >
              {{ e.campaignName }}
            </RouterLink>
          </div>
          <p v-if="e.result" class="gaf__result">
            {{ e.result }}
            <span v-if="duration(e)" class="gaf__dur">· {{ duration(e) }}</span>
          </p>
        </div>
        <span class="gaf__status">
          <v-icon
            v-if="e.status === 'completed'"
            icon="mdi-check"
            size="16"
            color="success"
            :title="t('adminGoogleAdsOpt.eventStatus.completed')"
          />
          <GaChip v-else :tone="STATUS[e.status].tone">
            {{ t(`adminGoogleAdsOpt.eventStatus.${e.status}`) }}
          </GaChip>
        </span>
      </li>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.gaf__bar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.5rem;
}
.gaf__live {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: var(--tvz-fs-small);
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.gaf__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), 0.3);
}
.gaf__live--on {
  color: rgb(var(--v-theme-primary));
}
.gaf__live--on .gaf__dot {
  background: rgb(var(--v-theme-success));
  animation: gaf-pulse 1.6s infinite;
}
@keyframes gaf-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(var(--v-theme-success), 0.55);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(var(--v-theme-success), 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(var(--v-theme-success), 0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .gaf__live--on .gaf__dot {
    animation: none;
  }
}
.gaf__filter {
  flex: none;
}
.gaf__empty {
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin: 0.5rem 0;
}
.gaf__list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--tvz-glass-border, var(--tvz-hairline));
  border-radius: var(--tvz-radius-md);
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}
.gaf__row {
  display: grid;
  grid-template-columns: 2.6rem 1.25rem minmax(0, 1fr) auto;
  align-items: start;
  gap: 0.6rem;
  padding: 0.55rem 0.85rem;
  cursor: default;
}
.gaf__row + .gaf__row {
  border-top: 1px solid var(--tvz-hairline);
}
.gaf__row:has(.gaf__result) {
  cursor: pointer;
}
.gaf__row:hover {
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.gaf__row--running {
  background: rgba(var(--v-theme-primary), 0.04);
}
.gaf__row--failed {
  background: rgba(var(--v-theme-error), 0.035);
}
.gaf__time {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-variant-numeric: tabular-nums;
  padding-top: 0.1rem;
}
.gaf__icon {
  display: flex;
  justify-content: center;
  padding-top: 0.1rem;
  opacity: 0.65;
}
.gaf__main {
  min-width: 0;
}
.gaf__head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  min-width: 0;
}
.gaf__msg {
  overflow-wrap: anywhere;
  min-width: 0;
  font-size: var(--tvz-fs-small);
  font-weight: 500;
  flex: none;
  max-width: 100%;
}
.gaf__camp {
  min-width: 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gaf__camp:hover {
  color: rgb(var(--v-theme-primary));
  text-decoration: underline;
}
.gaf__result {
  margin: 0.1rem 0 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.gaf__row--open .gaf__result {
  -webkit-line-clamp: unset;
}
.gaf__dur {
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.gaf__status {
  padding-top: 0.05rem;
}
.gaf-row-enter-active {
  transition: all 0.35s ease;
}
.gaf-row-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}
@media (prefers-reduced-motion: reduce) {
  .gaf-row-enter-active {
    transition: none;
  }
}
@media (max-width: 600px) {
  .gaf__head {
    flex-wrap: wrap;
  }
  .gaf__camp {
    flex-basis: 100%;
  }
  .gaf__row {
    grid-template-columns: 1.25rem minmax(0, 1fr) auto;
  }
  .gaf__time {
    display: none;
  }
}
</style>
