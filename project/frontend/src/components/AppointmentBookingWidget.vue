<script setup lang="ts">
/**
 * The live booking widget rendered for an `appointment` section — the ONLY
 * appointment-booking UI the platform ships. Always talks to the real
 * AppointmentsService public endpoints (never invented markup/fields), same
 * "AI controls copy, this component controls structure + data" split as the
 * contact form in WebsiteRenderer.vue.
 */
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { bookAppointment, getAvailableSlots, type AvailableSlot } from '@/services/appointments'

const props = defineProps<{
  /** Absent in builder previews — the widget stays inert (no live fetch). */
  slug?: string
}>()
const emit = defineEmits<{ (e: 'booked'): void }>()

const { t, locale } = useI18n()

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}
function addDays(dateISO: string, n: number): string {
  const d = new Date(`${dateISO}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const selectedDate = ref(todayISO())
const minDate = todayISO()
const maxDate = addDays(todayISO(), 60)

const loading = ref(false)
const loadError = ref(false)
const enabled = ref(true)
const slots = ref<AvailableSlot[]>([])
const selectedSlot = ref<AvailableSlot | null>(null)

async function loadSlots(): Promise<void> {
  if (!props.slug) return
  loading.value = true
  loadError.value = false
  selectedSlot.value = null
  try {
    const res = await getAvailableSlots(props.slug, selectedDate.value)
    enabled.value = res.enabled
    slots.value = res.slots
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}
watch(selectedDate, loadSlots, { immediate: true })

// Explicit timeZone: the slot is a real Romania-local time — a visitor
// browsing from a different timezone must still see (and book) the actual
// local hour, not one reinterpreted for wherever they happen to be.
const timeFmt = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Bucharest',
    }),
)
function slotLabel(s: AvailableSlot): string {
  return timeFmt.value.format(new Date(s.startsAt))
}

function selectSlot(s: AvailableSlot): void {
  selectedSlot.value = s
  bState.value = 'idle'
}

// --- booking form -----------------------------------------------------
const bf = reactive({ name: '', email: '', phone: '', notes: '' })
const bState = ref<'idle' | 'busy' | 'sent' | 'error'>('idle')
const bError = ref('')
const bValid = computed(() => bf.name.trim().length > 1)

async function submitBooking(): Promise<void> {
  if (!props.slug || !selectedSlot.value || !bValid.value || bState.value === 'busy') return
  bState.value = 'busy'
  bError.value = ''
  try {
    const res = await bookAppointment(props.slug, {
      startsAt: selectedSlot.value.startsAt,
      name: bf.name.trim(),
      email: bf.email.trim() || undefined,
      phone: bf.phone.trim() || undefined,
      notes: bf.notes.trim() || undefined,
    })
    if (!res.ok) {
      bState.value = 'error'
      bError.value = res.error === 'slot_taken' ? t('site.aptSlotTaken') : t('site.formError')
      if (res.error === 'slot_taken') void loadSlots()
      return
    }
    bState.value = 'sent'
    emit('booked')
  } catch {
    bState.value = 'error'
    bError.value = t('site.formError')
  }
}
</script>

<template>
  <div class="apw" :class="{ 'apw--preview': !slug }">
    <div v-if="bState === 'sent'" class="apw__ok">
      <span aria-hidden="true">✓</span> {{ t('site.aptThanks') }}
    </div>

    <template v-else>
      <div class="apw__datebar">
        <input
          type="date"
          :min="minDate"
          :max="maxDate"
          :value="selectedDate"
          :disabled="!slug"
          @change="selectedDate = ($event.target as HTMLInputElement).value"
        />
      </div>

      <div v-if="loading" class="apw__center">
        <span class="apw__spinner" aria-hidden="true" />
      </div>
      <p v-else-if="loadError" class="apw__note">{{ t('site.aptLoadError') }}</p>
      <p v-else-if="!enabled" class="apw__note">{{ t('site.aptDisabled') }}</p>
      <p v-else-if="!slots.length" class="apw__note">{{ t('site.aptNoSlots') }}</p>

      <div v-else class="apw__slots">
        <button
          v-for="s in slots"
          :key="s.startsAt"
          type="button"
          class="apw__slot"
          :class="{ 'is-on': selectedSlot?.startsAt === s.startsAt }"
          :disabled="!slug"
          @click="selectSlot(s)"
        >
          {{ slotLabel(s) }}
        </button>
      </div>

      <form v-if="selectedSlot" class="apw__form" @submit.prevent="submitBooking">
        <div class="apw__row">
          <input v-model="bf.name" type="text" :placeholder="t('site.fName')" autocomplete="name" required :disabled="!slug" />
          <input v-model="bf.email" type="email" :placeholder="t('site.fEmail')" autocomplete="email" :disabled="!slug" />
        </div>
        <input v-model="bf.phone" type="tel" :placeholder="t('site.fPhone')" autocomplete="tel" :disabled="!slug" />
        <textarea v-model="bf.notes" rows="2" :placeholder="t('site.aptNotes')" :disabled="!slug"></textarea>
        <p v-if="bState === 'error'" class="apw__err">{{ bError }}</p>
        <button type="submit" class="btn btn--solid" :disabled="!slug || !bValid || bState === 'busy'">
          {{ bState === 'busy' ? t('site.formSending') : t('site.aptBook') }}
        </button>
        <p v-if="!slug" class="apw__note">{{ t('site.formPreview') }}</p>
      </form>
    </template>
  </div>
</template>

<style scoped>
.apw {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.apw__datebar input[type='date'] {
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--site-border, rgba(0, 0, 0, 0.15));
  border-radius: 8px;
  font: inherit;
  color: inherit;
  background: transparent;
}
.apw__center {
  display: grid;
  place-items: center;
  padding: 1.2rem 0;
}
.apw__spinner {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid rgba(0, 0, 0, 0.15);
  border-top-color: currentColor;
  animation: apw-spin 0.7s linear infinite;
}
@keyframes apw-spin {
  to {
    transform: rotate(360deg);
  }
}
.apw__note {
  margin: 0;
  font-size: 0.88rem;
  opacity: 0.65;
}
.apw__slots {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.apw__slot {
  padding: 0.45rem 0.85rem;
  border: 1px solid var(--site-border, rgba(0, 0, 0, 0.15));
  border-radius: 8px;
  font: inherit;
  font-size: 0.88rem;
  color: inherit;
  background: transparent;
  transition:
    background 0.14s ease,
    color 0.14s ease,
    border-color 0.14s ease;
}
.apw__slot.is-on {
  background: var(--site-accent);
  color: var(--site-accent-ink);
  border-color: var(--site-accent);
}
.apw__slot:disabled {
  opacity: 0.5;
  cursor: default;
}
.apw__form {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding-top: 0.4rem;
  border-top: 1px dashed var(--site-border, rgba(0, 0, 0, 0.12));
}
.apw__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}
.apw__form input,
.apw__form textarea {
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--site-border, rgba(0, 0, 0, 0.15));
  border-radius: 8px;
  font: inherit;
  background: transparent;
  color: inherit;
}
.apw__err {
  margin: 0;
  font-size: 0.82rem;
  color: #c0392b;
}
.apw__ok {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
}
.apw--preview .apw__slot,
.apw--preview input,
.apw--preview textarea {
  pointer-events: none;
}

@media (max-width: 480px) {
  .apw__row {
    grid-template-columns: 1fr;
  }
}
</style>
