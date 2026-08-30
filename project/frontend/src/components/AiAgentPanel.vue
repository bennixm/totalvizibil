<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { DraftTurn } from '@/stores/websiteDraft'

const props = withDefaults(
  defineProps<{
    transcript: DraftTurn[]
    sending: boolean
    disabled: boolean
    /** Free-plan message counter; omit to hide it. */
    turnsLeft?: number
    /** Custom sub-label under the agent name (replaces the counter). */
    note?: string
    /** i18n prefix for assistant message keys. */
    msgPrefix?: string
  }>(),
  { msgPrefix: 'studio.msg.' },
)

const emit = defineEmits<{ send: [text: string] }>()

const { t } = useI18n()

const draft = ref('')
const scroller = ref<HTMLElement | null>(null)

function turnText(turn: DraftTurn): string {
  if (turn.role === 'user') return turn.text ?? ''
  return turn.key ? t(`${props.msgPrefix}${turn.key}`) : ''
}

function submit(): void {
  const text = draft.value.trim()
  if (!text || props.disabled || props.sending) return
  emit('send', text)
  draft.value = ''
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}

watch(
  () => [props.transcript.length, props.sending] as const,
  async () => {
    await nextTick()
    scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: 'smooth' })
  },
)
</script>

<template>
  <div class="agent">
    <header class="agent__head">
      <span class="agent__orb" :class="{ 'agent__orb--busy': sending }" aria-hidden="true">
        <v-icon icon="mdi-robot-happy-outline" size="20" />
      </span>
      <div class="agent__id">
        <strong>{{ t('studio.agentName') }}</strong>
        <span v-if="note">{{ note }}</span>
        <span v-else-if="turnsLeft !== undefined">{{ t('studio.turnsLeft', { n: turnsLeft }) }}</span>
      </div>
    </header>

    <div ref="scroller" class="agent__log">
      <div
        v-for="(turn, i) in transcript"
        :key="i"
        class="msg"
        :class="turn.role === 'user' ? 'msg--user' : 'msg--agent'"
      >
        <p>{{ turnText(turn) }}</p>
      </div>
      <div v-if="sending" class="msg msg--agent msg--typing" aria-hidden="true">
        <span /><span /><span />
      </div>
    </div>

    <form class="agent__input" @submit.prevent="submit">
      <textarea
        v-model="draft"
        :placeholder="t('studio.inputPlaceholder')"
        :disabled="disabled"
        rows="1"
        @keydown="onKeydown"
      />
      <v-btn
        type="submit"
        icon="mdi-send"
        size="small"
        color="primary"
        :disabled="disabled || !draft.trim()"
        :loading="sending"
        :aria-label="t('studio.send')"
      />
    </form>
  </div>
</template>

<style scoped>
.agent {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  box-shadow: var(--tvz-shadow-sm);
  overflow: hidden;
}

.agent__head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.9rem 1rem;
  border-bottom: 1px solid var(--tvz-hairline);
}
.agent__orb {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  color: #fff;
  background: linear-gradient(135deg, rgb(var(--v-theme-primary)), var(--tvz-ai));
  box-shadow: 0 0 0 4px var(--tvz-ai-soft);
}
.agent__orb--busy {
  animation: orb-pulse 1.2s ease-in-out infinite;
}
@keyframes orb-pulse {
  50% {
    box-shadow: 0 0 0 9px var(--tvz-ai-soft);
  }
}
.agent__id {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}
.agent__id strong {
  font-size: 0.92rem;
}
.agent__id span {
  font-size: 0.72rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}

.agent__log {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.msg {
  max-width: 85%;
  padding: 0.6rem 0.85rem;
  border-radius: 14px;
  font-size: 0.9rem;
  line-height: 1.5;
  white-space: pre-wrap;
}
.msg p {
  margin: 0;
}
.msg--agent {
  align-self: flex-start;
  background: rgb(var(--v-theme-on-surface) / 0.06);
  border-bottom-left-radius: 4px;
}
.msg--user {
  align-self: flex-end;
  background: rgb(var(--v-theme-primary) / 0.14);
  border-bottom-right-radius: 4px;
}
.msg--typing {
  display: flex;
  gap: 4px;
}
.msg--typing span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgb(var(--v-theme-on-surface) / 0.4);
  animation: typing 1s ease-in-out infinite;
}
.msg--typing span:nth-child(2) {
  animation-delay: 0.15s;
}
.msg--typing span:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes typing {
  50% {
    transform: translateY(-4px);
    opacity: 0.5;
  }
}

.agent__input {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  padding: 0.75rem;
  border-top: 1px solid var(--tvz-hairline);
}
.agent__input textarea {
  flex: 1;
  resize: none;
  max-height: 120px;
  padding: 0.55rem 0.75rem;
  border-radius: 12px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-background));
  color: inherit;
  font: inherit;
  font-size: 0.9rem;
  line-height: 1.4;
}
.agent__input textarea:focus {
  outline: 2px solid rgb(var(--v-theme-primary) / 0.4);
  outline-offset: 1px;
}
.agent__input textarea:disabled {
  opacity: 0.5;
}
</style>
