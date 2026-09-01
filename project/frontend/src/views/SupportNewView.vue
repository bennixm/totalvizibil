<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import { useCompaniesStore } from '@/stores/companies'
import {
  useSupportStore,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  type TicketCategory,
  type TicketPriority,
} from '@/stores/support'

const { t } = useI18n()
const router = useRouter()
const support = useSupportStore()
const companies = useCompaniesStore()
const { overview } = storeToRefs(companies)
const { working, error } = storeToRefs(support)

const CATEGORY_ICONS: Record<TicketCategory, string> = {
  bug: 'mdi-bug-outline',
  problem: 'mdi-alert-octagon-outline',
  question: 'mdi-help-circle-outline',
  billing: 'mdi-credit-card-outline',
  feedback: 'mdi-lightbulb-on-outline',
  other: 'mdi-dots-horizontal',
}

const subject = ref('')
const category = ref<TicketCategory>('bug')
const priority = ref<TicketPriority>('normal')
const companyId = ref<string | null>(null)
const body = ref('')
const submitted = ref(false)

const companyOptions = computed(() => [
  { title: t('support.noBusiness'), value: null },
  ...overview.value.map((c) => ({ title: c.displayName, value: c.id })),
])

const subjectValid = computed(() => subject.value.trim().length >= 4)
const bodyValid = computed(() => body.value.trim().length >= 10)
const canSubmit = computed(() => subjectValid.value && bodyValid.value && !working.value)

const errText = computed(() => {
  const c = error.value
  if (!c) return ''
  return ['not_a_member'].includes(c) ? t('support.err.' + c) : c
})

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  submitted.value = true
  const ticket = await support.create({
    subject: subject.value.trim(),
    body: body.value.trim(),
    category: category.value,
    priority: priority.value,
    companyId: companyId.value ?? undefined,
  })
  if (ticket) void router.replace({ name: 'support-ticket', params: { id: ticket.id } })
}

onMounted(() => {
  void companies.fetchOverview().catch(() => {})
})
</script>

<template>
  <div class="new">
    <v-btn
      variant="text"
      size="small"
      prepend-icon="mdi-arrow-left"
      class="new__back"
      :to="{ name: 'support' }"
    >
      {{ t('support.back') }}
    </v-btn>
    <h1>{{ t('support.newTitle') }}</h1>
    <p class="new__lead">{{ t('support.newLead') }}</p>

    <form class="new__card" @submit.prevent="submit">
      <div class="fld">
        <label class="fld__label" for="new-subject">{{ t('support.fieldSubject') }}</label>
        <v-text-field
          id="new-subject"
          v-model="subject"
          :placeholder="t('support.subjectPlaceholder')"
          variant="outlined"
          density="comfortable"
          :error="submitted && !subjectValid"
          hide-details
          maxlength="160"
        />
      </div>

      <div class="fld">
        <span class="fld__label">{{ t('support.fieldCategory') }}</span>
        <div class="chips">
          <button
            v-for="c in TICKET_CATEGORIES"
            :key="c"
            type="button"
            class="chip"
            :class="{ 'is-on': category === c }"
            @click="category = c"
          >
            <v-icon :icon="CATEGORY_ICONS[c]" size="15" />
            {{ t('support.category.' + c) }}
          </button>
        </div>
      </div>

      <div class="fld">
        <span class="fld__label">{{ t('support.fieldPriority') }}</span>
        <div class="pseg">
          <button
            v-for="p in TICKET_PRIORITIES"
            :key="p"
            type="button"
            :class="{ 'is-on': priority === p }"
            @click="priority = p"
          >
            {{ t('support.priority.' + p) }}
          </button>
        </div>
      </div>

      <div v-if="companyOptions.length > 1" class="fld">
        <label class="fld__label">{{ t('support.fieldBusiness') }}</label>
        <v-select
          v-model="companyId"
          :items="companyOptions"
          variant="outlined"
          density="comfortable"
          hide-details
        />
      </div>

      <div class="fld">
        <label class="fld__label" for="new-body">{{ t('support.fieldBody') }}</label>
        <v-textarea
          id="new-body"
          v-model="body"
          :placeholder="t('support.bodyPlaceholder')"
          variant="outlined"
          auto-grow
          rows="6"
          :error="submitted && !bodyValid"
          hide-details
          maxlength="5000"
        />
      </div>

      <p v-if="errText" class="new__err">
        <v-icon icon="mdi-alert-circle-outline" size="16" /> {{ errText }}
      </p>

      <div class="new__actions">
        <v-btn variant="text" :to="{ name: 'support' }">{{ t('common.cancel') }}</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          class="new__submit"
          :disabled="!canSubmit"
          :loading="working"
          append-icon="mdi-send"
          @click="submit"
        >
          {{ t('support.submit') }}
        </v-btn>
      </div>
    </form>
  </div>
</template>

<style scoped>
.new {
  max-width: 620px;
  margin-inline: auto;
  padding: clamp(1.25rem, 4vw, 2.5rem) clamp(1rem, 4vw, 1.5rem) 4rem;
}
.new__back {
  margin-bottom: 0.75rem;
  margin-left: -0.5rem;
}
.new h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.5rem, 4vw, 2rem);
  letter-spacing: -0.025em;
  margin: 0;
}
.new__lead {
  margin: 0.6rem 0 1.75rem;
  font-size: 0.92rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}

.new__card {
  display: flex;
  flex-direction: column;
  gap: 1.4rem;
  padding: 1.6rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
}

.fld__label {
  display: block;
  margin-bottom: 0.5rem;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}

/* Category chips */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.85rem;
  font-size: 0.85rem;
  font-weight: 500;
  border-radius: 8px;
  border: 1px solid var(--tvz-hairline);
  color: rgb(var(--v-theme-on-surface) / 0.72);
  background: rgb(var(--v-theme-surface));
  transition:
    border-color var(--tvz-dur-fast) var(--tvz-ease-out),
    background var(--tvz-dur-fast) var(--tvz-ease-out),
    color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.chip:hover {
  border-color: rgb(var(--v-theme-primary) / 0.4);
}
.chip.is-on {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary) / 0.1);
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}

/* Priority segmented control */
.pseg {
  display: inline-flex;
  border: 1px solid var(--tvz-hairline);
  border-radius: 8px;
  overflow: hidden;
}
.pseg button {
  padding: 0.5rem 1rem;
  font-size: 0.83rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.6);
  transition: background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.pseg button + button {
  border-left: 1px solid var(--tvz-hairline);
}
.pseg button.is-on {
  background: rgb(var(--v-theme-primary) / 0.12);
  color: rgb(var(--v-theme-primary));
}

.new__err {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-size: 0.84rem;
  color: rgb(var(--v-theme-error));
}
.new__actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.25rem;
}
.new__submit {
  border-radius: 9px;
}

@media (max-width: 520px) {
  .pseg {
    width: 100%;
  }
  .pseg button {
    flex: 1;
    text-align: center;
    padding-inline: 0.4rem;
  }
}
</style>
