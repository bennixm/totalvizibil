<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import InfoHint from '@/components/InfoHint.vue'
import { useCompaniesStore } from '@/stores/companies'
import { useLeadsStore, type Lead, type LeadStatus } from '@/stores/leads'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const companies = useCompaniesStore()
const leads = useLeadsStore()
const { items, summary, filters, loading, working, nextCursor, error } = storeToRefs(leads)

const companyId = ref<string | null>(null)
const expanded = ref<string | null>(null)
const toDelete = ref<Lead | null>(null)

// Quick-reply composer
const replyFor = ref<string | null>(null)
const replyBody = ref('')
const replySnack = ref(false)

const STATUS_TABS: Array<{ v: '' | LeadStatus; key: string }> = [
  { v: '', key: 'leads.filterAll' },
  { v: 'new', key: 'leads.filterNew' },
  { v: 'resolved', key: 'leads.filterResolved' },
]
const CHANNEL_TABS = [
  { v: '' as const, key: 'leads.chAll' },
  { v: 'form' as const, key: 'leads.chForm' },
  { v: 'call' as const, key: 'leads.chCall' },
]

const rtf = computed(() => new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' }))
function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.round(diff / 60000)
  if (min < 1) return rtf.value.format(0, 'minute')
  if (min < 60) return rtf.value.format(-min, 'minute')
  const hr = Math.round(min / 60)
  if (hr < 24) return rtf.value.format(-hr, 'hour')
  return rtf.value.format(-Math.round(hr / 24), 'day')
}
function duration(min: number): string {
  if (min < 1) return t('leads.instant')
  if (min < 60) return `${min} min`
  if (min < 60 * 24) return `${Math.round(min / 60)} h`
  return `${Math.round(min / 1440)} ${t('leads.days')}`
}
function responseText(min: number): string {
  if (min < 1) return t('leads.respondedInstant')
  return t('leads.respondedIn', { v: duration(min) })
}
function avgText(min: number | null): string {
  return min == null ? '—' : duration(min)
}
function leadName(lead: Lead): string {
  return lead.name || (lead.channel === 'call' ? t('leads.aCall') : t('leads.aMessage'))
}

function onContact(lead: Lead, via: 'email' | 'phone'): void {
  // Fire-and-forget: don't block the mailto:/tel: navigation.
  leads.logResponse(lead.id, via)
}

/** Reveal the visitor's phone number — logs the response so no call goes untracked. */
function revealPhone(lead: Lead): void {
  void leads.revealPhone(lead.id)
}

function openReply(lead: Lead): void {
  replyFor.value = lead.id
  replyBody.value = ''
}
function closeReply(): void {
  replyFor.value = null
  replyBody.value = ''
}
async function sendReply(lead: Lead): Promise<void> {
  const body = replyBody.value.trim()
  if (body.length < 2) return
  const ok = await leads.reply(lead.id, body)
  if (ok) {
    closeReply()
    replySnack.value = true
  }
}

async function confirmDelete(): Promise<void> {
  if (!toDelete.value) return
  await leads.remove(toDelete.value.id)
  toDelete.value = null
}

onMounted(async () => {
  await companies.fetchOverview().catch(() => {})
  const id = companies.resolveId(route.query.c)
  if (!id) {
    void router.replace({ name: 'dashboard' })
    return
  }
  companyId.value = id
  await leads.load(id)
})
</script>

<template>
  <v-container class="lds">
    <header class="lds__head">
      <div>
        <p class="lds__eyebrow">{{ t('leads.eyebrow') }}</p>
        <h1>{{ t('leads.title') }}</h1>
      </div>
      <v-btn variant="text" size="small" prepend-icon="mdi-arrow-left" :to="{ name: 'dashboard' }">
        {{ t('leads.back') }}
      </v-btn>
    </header>

    <div v-if="loading && !summary" class="lds__center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else>
      <!-- Summary -->
      <div v-if="summary" class="lds__stats">
        <div><span>{{ t('leads.statNew') }}</span><strong>{{ summary.new }}</strong></div>
        <div><span>{{ t('leads.statTotal') }}</span><strong>{{ summary.total }}</strong></div>
        <div><span>{{ t('leads.statForm') }}</span><strong>{{ summary.form }}</strong></div>
        <div><span>{{ t('leads.statCall') }}</span><strong>{{ summary.call }}</strong></div>
        <div>
          <span>
            {{ t('leads.statAvg') }}
            <InfoHint :text="t('leads.statAvgHint')" />
          </span>
          <strong>{{ avgText(summary.avgResponseMinutes) }}</strong>
        </div>
      </div>

      <p class="lds__autonote">
        <v-icon icon="mdi-flash-outline" size="14" /> {{ t('leads.autoNote') }}
      </p>

      <!-- Filters -->
      <div class="lds__filters">
        <div class="lds__seg">
          <button
            v-for="tab in STATUS_TABS"
            :key="tab.v || 'all'"
            type="button"
            :class="{ 'is-on': filters.status === tab.v }"
            @click="leads.setFilter('status', tab.v)"
          >
            {{ t(tab.key) }}
          </button>
        </div>
        <div class="lds__seg">
          <button
            v-for="tab in CHANNEL_TABS"
            :key="tab.v || 'all'"
            type="button"
            :class="{ 'is-on': filters.channel === tab.v }"
            @click="leads.setFilter('channel', tab.v)"
          >
            {{ t(tab.key) }}
          </button>
        </div>
      </div>

      <div v-if="error" class="lds__error">
        <v-icon icon="mdi-alert-circle-outline" size="16" /> {{ error }}
      </div>

      <!-- Empty -->
      <div v-if="!items.length" class="lds__empty">
        <v-icon icon="mdi-inbox-outline" size="36" />
        <p>{{ t('leads.empty') }}</p>
        <span>{{ t('leads.emptyHint') }}</span>
      </div>

      <!-- List -->
      <ul v-else class="lds__list">
        <li
          v-for="lead in items"
          :key="lead.id"
          class="lead"
          :class="{
            'lead--new': lead.status === 'new',
            'lead--rich': lead.channel === 'form' && (lead.email || lead.phone),
            'lead--done': !!lead.firstResponseAt,
          }"
        >
          <div class="lead__top">
            <span class="lead__ic" :class="`lead__ic--${lead.channel}`">
              <v-icon :icon="lead.channel === 'call' ? 'mdi-phone' : 'mdi-email-fast-outline'" size="20" />
            </span>
            <div class="lead__who">
              <strong>{{ leadName(lead) }}</strong>
              <span class="lead__time">
                {{ lead.channel === 'call' ? t('leads.aCall') : t('leads.chForm') }} · {{ ago(lead.createdAt) }}
              </span>
            </div>
            <span class="lead__badge" :class="`lead__badge--${lead.status}`">
              {{ t('leads.status.' + lead.status) }}
            </span>
          </div>

          <p
            v-if="lead.message"
            class="lead__msg"
            :class="{ 'is-clamped': expanded !== lead.id }"
            @click="expanded = expanded === lead.id ? null : lead.id"
          >
            {{ lead.message }}
          </p>

          <!-- Prominent contact block: tapping either row logs the response -->
          <div v-if="lead.email || lead.phone || lead.hasPhone" class="lead__contact">
            <a
              v-if="lead.email"
              :href="`mailto:${lead.email}`"
              class="crow"
              @click="onContact(lead, 'email')"
            >
              <span class="crow__ic"><v-icon icon="mdi-email-outline" size="18" /></span>
              <span class="crow__body">
                <span class="crow__label">{{ t('leads.contactEmail') }}</span>
                <span class="crow__val">{{ lead.email }}</span>
              </span>
              <v-icon icon="mdi-arrow-top-right" size="15" class="crow__go" />
            </a>

            <!-- Revealed number -->
            <a
              v-if="lead.phone"
              :href="`tel:${lead.phone}`"
              class="crow"
              @click="onContact(lead, 'phone')"
            >
              <span class="crow__ic"><v-icon icon="mdi-phone-outline" size="18" /></span>
              <span class="crow__body">
                <span class="crow__label">{{ t('leads.contactPhone') }}</span>
                <span class="crow__val">{{ lead.phone }}</span>
              </span>
              <v-icon icon="mdi-arrow-top-right" size="15" class="crow__go" />
            </a>

            <!-- Hidden number — pressing this reveals it AND logs the response -->
            <button
              v-else-if="lead.hasPhone"
              type="button"
              class="crow crow--reveal"
              :disabled="working"
              @click="revealPhone(lead)"
            >
              <span class="crow__ic"><v-icon icon="mdi-phone-lock-outline" size="18" /></span>
              <span class="crow__body">
                <span class="crow__label">{{ t('leads.contactPhone') }}</span>
                <span class="crow__val crow__val--muted">{{ t('leads.phoneHidden') }}</span>
              </span>
              <span class="crow__revealCta">
                <v-icon icon="mdi-eye-outline" size="15" /> {{ t('leads.revealPhone') }}
              </span>
            </button>
          </div>
          <p v-if="!lead.phone && lead.hasPhone" class="lead__revealNote">
            <v-icon icon="mdi-information-outline" size="13" /> {{ t('leads.revealPhoneNote') }}
          </p>

          <!-- Response state -->
          <div v-if="lead.firstResponseAt" class="lead__responded">
            <div class="lead__respline">
              <v-icon icon="mdi-check-circle" size="15" />
              <span>{{ responseText(lead.responseMinutes ?? 0) }}</span>
              <span v-if="lead.respondedVia" class="lead__via">· {{ t('leads.via.' + lead.respondedVia) }}</span>
            </div>
            <blockquote v-if="lead.replyText" class="lead__reply">
              <span class="lead__replyHead">
                {{ t('leads.yourReply', { ago: lead.repliedAt ? ago(lead.repliedAt) : '' }) }}
              </span>
              {{ lead.replyText }}
            </blockquote>
          </div>

          <!-- Quick reply composer (form leads with an email, not yet answered) -->
          <div v-else-if="lead.channel === 'form' && lead.email" class="lead__quick">
            <v-btn
              v-if="replyFor !== lead.id"
              size="small"
              variant="tonal"
              color="primary"
              prepend-icon="mdi-reply"
              @click="openReply(lead)"
            >
              {{ t('leads.replyOpen') }}
            </v-btn>
            <div v-else class="qr">
              <p class="qr__to">{{ t('leads.replyTo', { who: lead.name || lead.email }) }}</p>
              <textarea
                v-model="replyBody"
                class="qr__input"
                rows="3"
                :placeholder="t('leads.replyPlaceholder')"
                autofocus
              />
              <div class="qr__actions">
                <v-btn size="small" variant="text" :disabled="working" @click="closeReply">
                  {{ t('common.cancel') }}
                </v-btn>
                <v-btn
                  size="small"
                  color="primary"
                  variant="flat"
                  prepend-icon="mdi-send"
                  :loading="working"
                  :disabled="replyBody.trim().length < 2"
                  @click="sendReply(lead)"
                >
                  {{ t('leads.replySend') }}
                </v-btn>
              </div>
            </div>
          </div>

          <!-- No contact details (e.g. a call, or a phone-only that was tapped) -->
          <p v-else-if="lead.channel === 'call'" class="lead__hint">
            <v-icon icon="mdi-information-outline" size="14" /> {{ t('leads.callHint') }}
          </p>

          <div class="lead__actions">
            <v-btn
              v-if="lead.status !== 'resolved'"
              size="small"
              variant="tonal"
              color="success"
              :disabled="working"
              prepend-icon="mdi-check"
              @click="leads.markResolved(lead.id)"
            >
              {{ t('leads.markResolved') }}
            </v-btn>
            <v-btn
              v-else
              size="small"
              variant="text"
              :disabled="working"
              prepend-icon="mdi-restore"
              @click="leads.reopen(lead.id)"
            >
              {{ t('leads.reopen') }}
            </v-btn>
            <v-spacer />
            <v-btn
              size="small"
              variant="text"
              color="error"
              :disabled="working"
              icon="mdi-trash-can-outline"
              :aria-label="t('leads.delete')"
              @click="toDelete = lead"
            />
          </div>
        </li>
      </ul>

      <v-btn
        v-if="nextCursor"
        variant="text"
        size="small"
        class="mt-2"
        :loading="working"
        @click="leads.loadMore()"
      >
        {{ t('leads.loadMore') }}
      </v-btn>
    </template>

    <v-dialog :model-value="!!toDelete" max-width="400" @update:model-value="toDelete = null">
      <v-card>
        <v-card-title class="text-h6">{{ t('leads.deleteConfirmTitle') }}</v-card-title>
        <v-card-text>{{ t('leads.deleteConfirmText') }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="working" @click="toDelete = null">
            {{ t('common.cancel') }}
          </v-btn>
          <v-btn color="error" variant="flat" :loading="working" @click="confirmDelete">
            {{ t('leads.delete') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="replySnack" :timeout="3000" color="success" location="bottom">
      {{ t('leads.replySent') }}
    </v-snackbar>
  </v-container>
</template>

<style scoped>
.lds {
  max-width: 720px;
  padding-block: clamp(1.5rem, 5vw, 3rem);
}
.lds__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.lds__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.25rem;
}
.lds__eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.45);
  margin: 0 0 0.3rem;
}
.lds__head h1 {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-weight: 700;
  font-size: clamp(1.5rem, 4vw, 2.1rem);
  letter-spacing: -0.02em;
  margin: 0;
}

.lds__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 1px;
  background: var(--tvz-hairline);
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-md);
  overflow: hidden;
  margin-bottom: 0.75rem;
}
.lds__stats > div {
  background: rgb(var(--v-theme-surface));
  padding: 0.7rem 0.85rem;
}
.lds__stats span {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  font-size: 0.64rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.lds__stats strong {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.15rem;
  font-variant-numeric: tabular-nums;
}
.lds__autonote {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0 0 1.25rem;
  font-size: 0.76rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}

.lds__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.lds__seg {
  display: inline-flex;
  border: 1px solid var(--tvz-glass-border);
  border-radius: 999px;
  overflow: hidden;
}
.lds__seg button {
  padding: 0.32rem 0.8rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.lds__seg button + button {
  border-left: 1px solid var(--tvz-glass-border);
}
.lds__seg button.is-on {
  background: rgb(var(--v-theme-primary) / 0.12);
  color: rgb(var(--v-theme-primary));
}

.lds__error {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: rgb(var(--v-theme-error));
  font-size: 0.82rem;
  margin-bottom: 0.75rem;
}
.lds__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  text-align: center;
  padding: 3rem 1rem;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.lds__empty p {
  margin: 0;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface) / 0.8);
}
.lds__empty span {
  font-size: 0.85rem;
}

.lds__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.lead {
  position: relative;
  border: 1px solid var(--tvz-glass-border);
  border-radius: var(--tvz-radius-lg);
  padding: 1.15rem 1.25rem;
  background: rgb(var(--v-theme-surface));
  transition:
    border-color var(--tvz-dur-fast) var(--tvz-ease-out),
    box-shadow var(--tvz-dur-fast) var(--tvz-ease-out);
}
.lead--rich {
  padding: 1.3rem 1.4rem;
}
.lead--new {
  border-color: rgb(var(--v-theme-primary) / 0.45);
  background:
    linear-gradient(165deg, rgb(var(--v-theme-primary) / 0.08), transparent 42%),
    rgb(var(--v-theme-surface));
}
.lead--new::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  border-radius: 999px 0 0 999px;
  background: rgb(var(--v-theme-primary));
}
.lead--done {
  border-color: rgb(var(--v-theme-success) / 0.35);
}
.lead__top {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}
.lead__ic {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  flex: none;
  color: #fff;
}
.lead__ic--form {
  background: linear-gradient(140deg, rgb(var(--v-theme-primary)), rgb(var(--v-theme-secondary)));
}
.lead__ic--call {
  background: linear-gradient(140deg, rgb(var(--v-theme-success)), rgb(var(--v-theme-primary)));
}
.lead__who {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}
.lead__who strong {
  font-size: 1rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lead__time {
  font-size: 0.74rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.lead__badge {
  font-size: 0.64rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: rgb(var(--v-theme-on-surface) / 0.08);
  color: rgb(var(--v-theme-on-surface) / 0.65);
  flex: none;
}
.lead__badge--new {
  background: rgb(var(--v-theme-primary) / 0.16);
  color: rgb(var(--v-theme-primary));
}
.lead__badge--resolved {
  background: rgb(var(--v-theme-success) / 0.16);
  color: rgb(var(--v-theme-success));
}
.lead__msg {
  margin: 0.85rem 0 0;
  font-size: 0.92rem;
  line-height: 1.55;
  color: rgb(var(--v-theme-on-surface) / 0.85);
  cursor: pointer;
  white-space: pre-wrap;
}
.lead__msg.is-clamped {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.lead__contact {
  display: grid;
  gap: 0.5rem;
  margin-top: 0.95rem;
}
.crow {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 0.85rem;
  border-radius: 12px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-on-surface) / 0.03);
  text-decoration: none;
  color: inherit;
  transition:
    border-color var(--tvz-dur-fast) var(--tvz-ease-out),
    background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.crow:hover {
  border-color: rgb(var(--v-theme-primary) / 0.55);
  background: rgb(var(--v-theme-primary) / 0.08);
}
.crow__ic {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  flex: none;
  background: rgb(var(--v-theme-primary) / 0.12);
  color: rgb(var(--v-theme-primary));
}
.crow__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}
.crow__label {
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}
.crow__val {
  font-size: 0.92rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.crow__go {
  flex: none;
  color: rgb(var(--v-theme-on-surface) / 0.4);
}
.crow:hover .crow__go {
  color: rgb(var(--v-theme-primary));
}

/* Hidden-phone reveal row */
.crow--reveal {
  width: 100%;
  text-align: left;
  cursor: pointer;
  border-style: dashed;
}
.crow--reveal:disabled {
  opacity: 0.6;
  cursor: default;
}
.crow__val--muted {
  color: rgb(var(--v-theme-on-surface) / 0.45);
  letter-spacing: 0.12em;
}
.crow__revealCta {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex: none;
  font-size: 0.78rem;
  font-weight: 700;
  color: rgb(var(--v-theme-primary));
}
.lead__revealNote {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0.45rem 0 0;
  font-size: 0.72rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}

.lead__responded {
  margin-top: 0.95rem;
}
.lead__respline {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: rgb(var(--v-theme-success));
}
.lead__via {
  font-weight: 400;
  color: rgb(var(--v-theme-on-surface) / 0.55);
}
.lead__reply {
  margin: 0.55rem 0 0;
  padding: 0.6rem 0.8rem;
  border-left: 2px solid rgb(var(--v-theme-primary) / 0.5);
  border-radius: 0 8px 8px 0;
  background: rgb(var(--v-theme-primary) / 0.05);
  font-size: 0.86rem;
  line-height: 1.5;
  color: rgb(var(--v-theme-on-surface) / 0.85);
  white-space: pre-wrap;
}
.lead__replyHead {
  display: block;
  font-size: 0.64rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgb(var(--v-theme-on-surface) / 0.45);
  margin-bottom: 0.25rem;
}

.lead__quick {
  margin-top: 0.95rem;
}
.qr {
  border: 1px solid rgb(var(--v-theme-primary) / 0.35);
  border-radius: 12px;
  padding: 0.85rem;
  background: rgb(var(--v-theme-primary) / 0.04);
}
.qr__to {
  margin: 0 0 0.5rem;
  font-size: 0.76rem;
  color: rgb(var(--v-theme-on-surface) / 0.6);
}
.qr__input {
  width: 100%;
  resize: vertical;
  min-height: 68px;
  padding: 0.6rem 0.7rem;
  border-radius: 9px;
  border: 1px solid var(--tvz-glass-border);
  background: rgb(var(--v-theme-surface));
  color: inherit;
  font: inherit;
  font-size: 0.9rem;
  line-height: 1.5;
}
.qr__input:focus {
  outline: none;
  border-color: rgb(var(--v-theme-primary) / 0.7);
}
.qr__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
  margin-top: 0.5rem;
}

.lead__hint {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.9rem 0 0;
  font-size: 0.78rem;
  color: rgb(var(--v-theme-on-surface) / 0.5);
}

.lead__actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 1rem;
  flex-wrap: wrap;
}
</style>
