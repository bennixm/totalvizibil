<script setup lang="ts">
/**
 * Admin › Utilizatori › user › "Afiliere": everything influencer/referral
 * about one account, moderated in one place.
 *  - Influencer profile: code, percentages, results, activate/deactivate,
 *    link to the full influencer page; or "make influencer" for any account.
 *  - "Adus de": the influencer code or user link this account joined with,
 *    the commission it generated; attach / detach a code while the account
 *    has no deposit yet (the code only ever discounts the first deposit).
 * Writes are admin-only (the backend enforces it too); finance only reads.
 */
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AdminSection from '@/components/admin/AdminSection.vue'
import AdminStatCard from '@/components/admin/AdminStatCard.vue'
import { ApiError, apiFetch } from '@/services/api'
import { adminCreateInfluencer, adminUpdateInfluencer } from '@/services/influencers'
import type { AdminUserDetail } from '@/stores/admin'
import { useConfirmStore } from '@/stores/confirm'
import { useToastStore } from '@/stores/toast'
import { uiLocale } from '@/plugins/i18n'

const props = defineProps<{ user: AdminUserDetail; isAdmin: boolean }>()
const emit = defineEmits<{ changed: [] }>()

const { t, n } = useI18n()
const toasts = useToastStore()
const confirmDialog = useConfirmStore()
const busy = ref(false)

const inf = computed(() => props.user.influencer)
const ref_ = computed(() => props.user.referredBy)

function eur(minor: number): string {
  return '€' + n(minor / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function cr(minor: number): string {
  return n(minor / 100, { maximumFractionDigits: 2 })
}
function day(iso: string): string {
  return new Date(iso).toLocaleDateString(uiLocale())
}

const ERRORS: Record<string, string> = {
  influencer_code_taken: 'adminInfl.errCodeTaken',
  influencer_code_invalid: 'adminInfl.errCodeInvalid',
  influencer_pct_invalid: 'adminInfl.errPct',
  already_influencer: 'adminInfl.errAlready',
  influencer_code_unknown: 'adminAff.errUnknownCode',
  influencer_own_code: 'adminAff.errOwnCode',
  referral_locked_after_deposit: 'adminAff.errLocked',
  referral_exists: 'adminAff.errExists',
}
function errText(e: unknown): string {
  if (e instanceof ApiError && ERRORS[e.message]) return t(ERRORS[e.message])
  return e instanceof Error ? e.message : t('admin.genericError')
}
async function run(fn: () => Promise<unknown>, okMsg: string): Promise<void> {
  busy.value = true
  try {
    await fn()
    toasts.success(okMsg)
    emit('changed')
  } catch (e) {
    toasts.error(errText(e))
  } finally {
    busy.value = false
  }
}

// --- make influencer -------------------------------------------------------
const makeOpen = ref(false)
const make = reactive({ code: '', discountPct: 10, commissionPct: 10 })
const makeValid = computed(
  () =>
    /^[A-Z0-9-]{3,24}$/.test(make.code.trim().toUpperCase()) &&
    [make.discountPct, make.commissionPct].every((v) => Number.isInteger(v) && v >= 0 && v <= 90),
)
function makeInfluencer(): void {
  void run(
    () =>
      adminCreateInfluencer({
        email: props.user.email,
        name: props.user.name,
        code: make.code.trim().toUpperCase(),
        discountPct: make.discountPct,
        commissionPct: make.commissionPct,
      }),
    t('adminInfl.created'),
  ).then(() => (makeOpen.value = false))
}

function toggleActive(): void {
  const i = inf.value
  if (!i) return
  void run(
    () => adminUpdateInfluencer(i.id, { active: !i.active }),
    i.active ? t('adminInfl.deactivated') : t('adminInfl.activated'),
  )
}

// --- attach / detach the code this account joined with ---------------------
const attachCode = ref('')
function attach(): void {
  const code = attachCode.value.trim().toUpperCase()
  if (!code) return
  void run(
    () => apiFetch(`/admin/users/${props.user.id}/referral`, { method: 'POST', body: { code } }),
    t('adminAff.attached', { code }),
  ).then(() => (attachCode.value = ''))
}
function detach(): void {
  confirmDialog.ask(t('adminAff.detachTitle'), t('adminAff.detachText'), () =>
    run(
      () => apiFetch(`/admin/users/${props.user.id}/referral`, { method: 'DELETE' }),
      t('adminAff.detached'),
    ),
  )
}
</script>

<template>
  <div class="uaf">
    <!-- ============ Influencer profile ============ -->
    <AdminSection :title="t('adminAff.influencerTitle')" icon="mdi-account-star-outline">
      <template v-if="inf">
        <div class="uaf__head">
          <span class="uaf__code">{{ inf.code }}</span>
          <span class="uaf__state" :class="inf.active ? 'is-on' : 'is-off'">
            {{ inf.active ? t('influencer.active') : t('influencer.inactive') }}
          </span>
          <span class="uaf__terms">
            {{ t('adminAff.terms', { discount: inf.discountPct, commission: inf.commissionPct }) }}
          </span>
        </div>
        <div class="uaf__kpis">
          <AdminStatCard :label="t('influencer.kpiUsers')" :value="n(inf.users)" icon="mdi-account-multiple-outline" />
          <AdminStatCard :label="t('influencer.kpiDepositors')" :value="n(inf.depositors)" icon="mdi-account-cash-outline" />
          <AdminStatCard :label="t('influencer.kpiRevenue')" :value="eur(inf.firstDepositsPaid.minor)" icon="mdi-chart-line" />
          <AdminStatCard :label="t('influencer.kpiCommissions')" :value="cr(inf.commissions.minor)" value-is-credits icon="mdi-gift-outline" tone="success" />
        </div>
        <div class="uaf__actions">
          <v-btn
            variant="tonal"
            color="primary"
            prepend-icon="mdi-open-in-app"
            :to="{ name: 'admin-influencer', params: { id: inf.id } }"
          >
            {{ t('adminAff.openInfluencer') }}
          </v-btn>
          <v-btn
            v-if="isAdmin"
            :variant="inf.active ? 'tonal' : 'flat'"
            :color="inf.active ? 'warning' : 'success'"
            :loading="busy"
            @click="toggleActive"
          >
            {{ inf.active ? t('adminInfl.deactivate') : t('adminInfl.activate') }}
          </v-btn>
        </div>
      </template>

      <template v-else>
        <p class="uaf__muted">{{ t('adminAff.notInfluencer') }}</p>
        <template v-if="isAdmin">
          <v-btn v-if="!makeOpen" color="primary" variant="tonal" prepend-icon="mdi-account-star-outline" @click="makeOpen = true">
            {{ t('adminAff.makeInfluencer') }}
          </v-btn>
          <div v-else class="uaf__make">
            <v-text-field
              v-model="make.code"
              :label="t('adminInfl.fCode')"
              :hint="t('adminInfl.fCodeHint')"
              persistent-hint
              class="uaf__upper"
              @update:model-value="make.code = String($event ?? '').toUpperCase()"
            />
            <v-text-field v-model.number="make.discountPct" :label="t('adminInfl.fDiscount')" type="number" suffix="%" :min="0" :max="90" />
            <v-text-field v-model.number="make.commissionPct" :label="t('adminInfl.fCommission')" type="number" suffix="%" :min="0" :max="90" />
            <div class="uaf__makeActions">
              <v-btn variant="text" @click="makeOpen = false">{{ t('common.cancel') }}</v-btn>
              <v-btn color="primary" :loading="busy" :disabled="!makeValid" @click="makeInfluencer">
                {{ t('adminInfl.create') }}
              </v-btn>
            </div>
          </div>
        </template>
      </template>
    </AdminSection>

    <!-- ============ Who brought this account in ============ -->
    <AdminSection :title="t('adminAff.referredTitle')" icon="mdi-account-arrow-left-outline" :hint="t('adminAff.referredHint')">
      <template v-if="ref_">
        <dl class="uaf__facts">
          <div>
            <dt>{{ t('adminAff.via') }}</dt>
            <dd>
              <template v-if="ref_.kind === 'influencer' && ref_.influencer">
                <router-link :to="{ name: 'admin-influencer', params: { id: ref_.influencer.id } }" class="uaf__link">
                  {{ ref_.referrer.name }}
                </router-link>
                <span class="uaf__badge">{{ t('adminAff.influencerCode', { code: ref_.influencer.code }) }}</span>
              </template>
              <template v-else>
                <router-link :to="{ name: 'admin-user', params: { id: ref_.referrer.id } }" class="uaf__link">
                  {{ ref_.referrer.name }}
                </router-link>
                <span class="uaf__badge uaf__badge--muted">{{ t('adminAff.userLink') }}</span>
              </template>
            </dd>
          </div>
          <div>
            <dt>{{ t('adminAff.since') }}</dt>
            <dd>{{ day(ref_.createdAt) }}</dd>
          </div>
          <div v-if="ref_.kind === 'influencer'">
            <dt>{{ t('adminAff.commission') }}</dt>
            <dd>
              <template v-if="ref_.commission">
                {{ cr(ref_.commission.commission.minor) }} cr
                <small class="uaf__muted">
                  {{ t('adminAff.onDeposit', { paid: eur(ref_.commission.depositPaid.minor), pct: ref_.commission.discountPct }) }}
                </small>
              </template>
              <span v-else class="uaf__muted">{{ t('adminAff.noFirstDeposit') }}</span>
            </dd>
          </div>
          <div v-else>
            <dt>{{ t('adminAff.reward') }}</dt>
            <dd>
              {{ ref_.status === 'rewarded' ? t('adminRef.rewarded') : t('adminRef.pending') }}
              <span v-if="ref_.rewardCredits != null" class="uaf__muted">({{ ref_.rewardCredits }} cr)</span>
            </dd>
          </div>
        </dl>
        <div v-if="isAdmin" class="uaf__actions">
          <v-btn
            v-if="user.canChangeReferral"
            variant="text"
            color="error"
            prepend-icon="mdi-link-variant-off"
            :loading="busy"
            @click="detach"
          >
            {{ t('adminAff.detach') }}
          </v-btn>
          <p v-else class="uaf__muted uaf__lock">
            <v-icon icon="mdi-lock-outline" size="14" /> {{ t('adminAff.locked') }}
          </p>
        </div>
      </template>

      <template v-else>
        <p class="uaf__muted">{{ t('adminAff.noReferral') }}</p>
        <div v-if="isAdmin && user.canChangeReferral && !inf" class="uaf__attach">
          <v-text-field
            v-model="attachCode"
            :label="t('adminAff.attachLabel')"
            density="compact"
            hide-details
            class="uaf__upper"
            @keyup.enter="attach"
          />
          <v-btn color="primary" variant="tonal" :loading="busy" :disabled="!attachCode.trim()" @click="attach">
            {{ t('adminAff.attach') }}
          </v-btn>
        </div>
        <p v-else-if="isAdmin && !user.canChangeReferral" class="uaf__muted uaf__lock">
          <v-icon icon="mdi-lock-outline" size="14" /> {{ t('adminAff.locked') }}
        </p>
      </template>
    </AdminSection>
  </div>
</template>

<style scoped>
.uaf {
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}
.uaf__head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.9rem;
}
.uaf__code {
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: rgb(var(--v-theme-primary));
}
.uaf__state {
  font-size: var(--tvz-fs-small);
  font-weight: 600;
}
.uaf__state.is-on {
  color: rgb(var(--v-theme-success));
}
.uaf__state.is-off {
  color: rgb(var(--v-theme-warning));
}
.uaf__terms {
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.65);
}
.uaf__kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.7rem;
}
.uaf__actions {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 0.9rem;
}
.uaf__muted {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: var(--tvz-fs-small);
  margin: 0 0 0.6rem;
}
.uaf__lock {
  display: flex;
  gap: 0.3rem;
  align-items: center;
  margin: 0;
}
.uaf__make {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.75rem;
  margin-top: 0.4rem;
}
.uaf__makeActions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
.uaf__upper :deep(input) {
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.uaf__facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.9rem;
  margin: 0;
}
.uaf__facts dt {
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.uaf__facts dd {
  margin: 0.15rem 0 0;
  font-weight: 600;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
}
.uaf__facts small {
  font-weight: 400;
  margin: 0;
}
.uaf__link {
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}
.uaf__link:hover {
  text-decoration: underline;
}
.uaf__badge {
  padding: 0.05rem 0.5rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 600;
  clip-path: var(--tvz-hex-xs);
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.uaf__badge--muted {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.uaf__attach {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  max-width: 460px;
}
@media (max-width: 760px) {
  .uaf__kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .uaf__make,
  .uaf__facts {
    grid-template-columns: 1fr;
  }
}
</style>
