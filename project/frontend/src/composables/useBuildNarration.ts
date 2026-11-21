import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * The simple builder's "AI is building" narration: while a request is in
 * flight, a rotating line of what the AI is doing for the current step
 * ("Citesc descrierea afacerii", "Scriu descrieri pentru fiecare serviciu"…).
 * The clock is module-level, so the chat status and the preview's build
 * console say the same thing at the same moment.
 */
const LINE_MS = 1700
const startedAt = ref(0)
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
let users = 0

export function useBuildNarration(step: Ref<string>, sending: Ref<boolean>) {
  const { tm, rt } = useI18n()
  users++
  if (!ticker) ticker = setInterval(() => (now.value = Date.now()), 400)
  onBeforeUnmount(() => {
    users--
    if (!users && ticker) {
      clearInterval(ticker)
      ticker = null
    }
  })
  watch(
    sending,
    (v) => {
      if (v && !startedAt.value) startedAt.value = Date.now()
      if (!v) startedAt.value = 0
    },
    { immediate: true },
  )

  /** Lines for the step being processed (falls back to `done`). */
  const lines = computed<string[]>(() => {
    const raw = tm(`studio.build.wait.${step.value}`) as unknown
    const list = Array.isArray(raw) && raw.length ? raw : (tm('studio.build.wait.done') as unknown[])
    return (list as Parameters<typeof rt>[0][]).map((m) => rt(m))
  })
  /** Index of the line in progress; the last one holds until the answer. */
  const index = computed(() =>
    startedAt.value
      ? Math.min(lines.value.length - 1, Math.floor((now.value - startedAt.value) / LINE_MS))
      : 0,
  )
  const current = computed(() => (sending.value ? lines.value[index.value] ?? '' : ''))
  return { lines, index, current }
}
