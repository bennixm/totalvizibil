<script setup lang="ts">
import { uiLocale } from '@/plugins/i18n'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AdminEmptyState from '@/components/admin/AdminEmptyState.vue'
import AdminFilterChip from '@/components/admin/AdminFilterChip.vue'
import AdminPageHeader from '@/components/admin/AdminPageHeader.vue'
import AdminPager from '@/components/admin/AdminPager.vue'
import { useAdminStore } from '@/stores/admin'
import type { PlatformRole } from '@/stores/auth'
import type { UserStatus } from '@/stores/admin'

const { t, n } = useI18n()
const router = useRouter()
const admin = useAdminStore()

const search = ref(admin.filters.search)
let deb: ReturnType<typeof setTimeout> | undefined
watch(search, (v) => {
  clearTimeout(deb)
  deb = setTimeout(() => admin.setFilter('search', v), 300)
})

// Quick-glance counts, independent of the current filter — reuses the same
// aggregate the admin dashboard already fetches. Clicking a chip toggles
// that status straight into the filter (a shortcut for the select below).
void admin.fetchStats()
const s = computed(() => admin.stats?.users)
function toggleStatus(status: UserStatus | null): void {
  admin.setFilter('status', admin.filters.status === status ? null : status)
}

const statusItems = computed(() => [
  { value: null, title: t('admin.filterAnyStatus') },
  { value: 'active', title: t('admin.userStatus.active') },
  { value: 'suspended', title: t('admin.userStatus.suspended') },
])
const roleItems = [
  { value: null, title: t('admin.filterAnyRole') },
  { value: 'admin', title: 'admin' },
  { value: 'support', title: 'support' },
  { value: 'finance', title: 'finance' },
  { value: 'moderator', title: 'moderator' },
  // Not a staff role: accounts with an influencer profile.
  { value: 'influencer', title: t('admin.navInfluencers') },
]

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('')
}
function credits(v: number): string {
  return n(Number(v), { maximumFractionDigits: 0 })
}
function lastLogin(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(uiLocale()) : t('admin.never')
}
/** A stable colour per person, so a face is recognisable across pages. */
function hue(seed: string): number {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}
function joined(iso: string): string {
  return new Date(iso).toLocaleDateString(uiLocale())
}

onMounted(() => admin.fetchUsers())

function open(id: string): void {
  void router.push({ name: 'admin-user', params: { id } })
}
</script>

<template>
  <div class="au">
    <AdminPageHeader
      :title="t('admin.navUsers')"
      :eyebrow="t('admin.navGroupClients')"
      :count="admin.usersTotal"
    />

    <div v-if="s" class="au__chips">
      <AdminFilterChip
        :label="t('admin.filterAnyStatus')"
        :value="n(s.total)"
        icon="mdi-account-multiple-outline"
        :active="admin.filters.status === null"
        @click="toggleStatus(null)"
      />
      <AdminFilterChip
        :label="t('admin.userStatus.active')"
        :value="n(s.active)"
        icon="mdi-check-circle-outline"
        tone="success"
        :active="admin.filters.status === 'active'"
        @click="toggleStatus('active')"
      />
      <AdminFilterChip
        :label="t('admin.userStatus.suspended')"
        :value="n(s.suspended)"
        icon="mdi-cancel"
        tone="error"
        :active="admin.filters.status === 'suspended'"
        @click="toggleStatus('suspended')"
      />
      <AdminFilterChip
        :label="t('admin.stat.users2fa')"
        :value="n(s.withTwoFactor)"
        icon="mdi-shield-check-outline"
      />
    </div>

    <div class="au__filters">
      <v-text-field
        v-model="search"
        :placeholder="t('admin.searchUsers')"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        class="au__search"
      />
      <v-select
        :model-value="admin.filters.status"
        :items="statusItems"
        variant="outlined"
        density="compact"
        hide-details
        class="au__sel"
        @update:model-value="admin.setFilter('status', $event as UserStatus | null)"
      />
      <v-select
        :model-value="admin.filters.role"
        :items="roleItems"
        variant="outlined"
        density="compact"
        hide-details
        class="au__sel"
        @update:model-value="admin.setFilter('role', $event as PlatformRole | 'influencer' | null)"
      />
    </div>

    <div v-if="admin.loadingUsers && !admin.users.length" class="au__center">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <!-- A failed fetch is NOT "no users" — a 403/timeout/500 used to render
         as a calm empty list with nothing to indicate anything broke. -->
    <AdminEmptyState
      v-else-if="admin.usersError"
      icon="mdi-alert-circle-outline"
      :text="admin.usersError"
    />
    <AdminEmptyState
      v-else-if="!admin.users.length"
      icon="mdi-account-search-outline"
      :text="t('admin.usersNone')"
    />

    <ul v-else class="au__grid">
      <li v-for="u in admin.users" :key="u.id">
        <article
          class="pc"
          :class="{ 'is-suspended': u.status === 'suspended' }"
          :style="{ '--pc-hue': hue(u.email) }"
          role="link"
          tabindex="0"
          :aria-label="u.name"
          @click="open(u.id)"
          @keydown.enter="open(u.id)"
        >
          <div class="pc__cover" aria-hidden="true">
            <span class="pc__go">
              {{ t('admin.openProfile') }}
              <v-icon icon="mdi-arrow-top-right" size="14" />
            </span>
          </div>

          <div class="pc__avrow">
            <span class="pc__ring" :class="{ 'is-2fa': u.twoFactorEnabled }">
              <span class="pc__av">{{ initials(u.name) }}</span>
            </span>
          </div>

          <div class="pc__id">
            <h3 class="pc__name">{{ u.name }}</h3>
            <p class="pc__mail">{{ u.email }}</p>
          </div>

          <div class="pc__tags">
            <span v-if="u.status === 'suspended'" class="tag tag--err">
              <v-icon icon="mdi-cancel" size="11" /> {{ t('admin.userStatus.suspended') }}
            </span>
            <span v-if="!u.emailVerified" class="tag tag--warn">
              <v-icon icon="mdi-email-alert-outline" size="11" /> {{ t('admin.userEmailUnverified') }}
            </span>
            <span v-for="r in u.platformRoles" :key="r" class="tag tag--role">{{ r }}</span>
            <span v-if="u.influencer" class="tag tag--infl" :class="{ 'is-off': !u.influencer.active }">
              <v-icon icon="mdi-account-star-outline" size="11" /> {{ u.influencer.code }}
            </span>
            <span v-if="!u.platformRoles.length && !u.influencer && u.status !== 'suspended' && u.emailVerified" class="tag">
              {{ t('admin.userClient') }}
            </span>
          </div>

          <dl class="pc__stats">
            <div>
              <dd>{{ u.companyCount }}</dd>
              <dt>{{ t('admin.colBusinesses') }}</dt>
            </div>
            <div>
              <dd>{{ u.adsCampaignCount }}</dd>
              <dt>{{ t('admin.colAdsCampaigns') }}</dt>
            </div>
            <div>
              <dd>
                <v-icon v-if="u.walletBlocked" icon="mdi-lock" size="14" color="error" :title="t('admin.walletFrozen')" />
                {{ credits(u.walletCredits) }}
              </dd>
              <dt>{{ t('admin.colWallet') }}</dt>
            </div>
          </dl>

          <footer class="pc__foot">
            <span
              :title="u.lastLoginAt ? t('admin.lastSeenOn', { date: lastLogin(u.lastLoginAt) }) : t('admin.neverSignedIn')"
            >
              <v-icon icon="mdi-clock-outline" size="15" />
              {{ u.lastLoginAt ? lastLogin(u.lastLoginAt) : t('admin.never') }}
            </span>
            <span :class="{ 'is-on': u.twoFactorEnabled }" :title="t('admin.stat.users2fa')">
              <v-icon :icon="u.twoFactorEnabled ? 'mdi-shield-check' : 'mdi-shield-off-outline'" size="15" />
              2FA
            </span>
            <span :title="t('admin.joinedOn', { date: joined(u.createdAt) })">
              <v-icon icon="mdi-calendar-blank-outline" size="15" />
              {{ joined(u.createdAt) }}
            </span>
          </footer>
        </article>
      </li>
    </ul>

    <AdminPager
      :page="admin.filters.page"
      :page-size="admin.filters.pageSize"
      :total="admin.usersTotal"
      @update:page="admin.setFilter('page', $event)"
    />
  </div>
</template>

<style scoped>
.au {
  max-width: 1320px;
}
.au__chips {
  display: flex;
  gap: 0.7rem;
  flex-wrap: wrap;
  margin-bottom: 1.1rem;
}
.au__filters {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-bottom: 1.1rem;
}
.au__search {
  flex: 1 1 240px;
}
.au__sel {
  max-width: 12rem;
}
.au__center {
  display: grid;
  place-items: center;
  min-height: 200px;
}
.au__grid {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 17.5rem), 1fr));
  gap: 0.9rem;
}
.au__grid > li {
  display: flex;
}

/* Profile card: a soft cover in the person's colour, a round avatar that
   overlaps it, the identity, a recessed stats panel and an icon strip. */
.pc {
  --pc-accent: hsl(var(--pc-hue) 70% 55%);
  --pc-r: 1.35rem;
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 0.45rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--pc-r);
  background: rgb(var(--v-theme-surface));
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.06),
    0 10px 28px -18px rgba(0, 0, 0, 0.45);
  overflow: hidden;
  cursor: pointer;
  transition:
    transform var(--tvz-dur-fast) var(--tvz-ease-out),
    border-color var(--tvz-dur-fast) var(--tvz-ease-out),
    box-shadow var(--tvz-dur-fast) var(--tvz-ease-out);
}
.pc:hover,
.pc:focus-visible {
  outline: none;
  transform: translateY(-3px);
  border-color: rgba(var(--v-theme-primary), 0.4);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.08),
    0 22px 40px -22px rgba(0, 0, 0, 0.55);
}
.pc.is-suspended {
  border-color: rgba(var(--v-theme-error), 0.45);
}

/* Cover: the person's colour with soft "cloud" highlights. */
.pc__cover {
  position: relative;
  height: 5.6rem;
  border-radius: calc(var(--pc-r) - 0.35rem);
  background:
    radial-gradient(60% 70% at 18% 30%, rgba(255, 255, 255, 0.55), transparent 70%),
    radial-gradient(45% 60% at 78% 75%, rgba(255, 255, 255, 0.38), transparent 70%),
    radial-gradient(35% 45% at 55% 20%, rgba(255, 255, 255, 0.3), transparent 70%),
    linear-gradient(135deg, hsl(var(--pc-hue) 62% 72%), hsl(calc(var(--pc-hue) + 45) 58% 64%));
}
.pc.is-suspended .pc__cover {
  filter: grayscale(1);
  opacity: 0.6;
}
.pc__go {
  position: absolute;
  top: 0.6rem;
  right: 0.6rem;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.32rem 0.55rem 0.32rem 0.75rem;
  border-radius: 999px;
  font-size: var(--tvz-fs-caption);
  font-weight: 600;
  color: #1d2433;
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(6px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  transition:
    background var(--tvz-dur-fast) var(--tvz-ease-out),
    color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.pc:hover .pc__go,
.pc:focus-visible .pc__go {
  background: #fff;
  color: rgb(var(--v-theme-primary));
}

/* Avatar: overlaps the cover; the ring turns green with 2FA on. */
.pc__avrow {
  display: flex;
  padding: 0 0.7rem;
  margin-top: -2.4rem;
}
.pc__ring {
  position: relative;
  display: grid;
  place-items: center;
  width: 4.7rem;
  height: 4.7rem;
  padding: 3px;
  border-radius: 50%;
  background: conic-gradient(
    from 200deg,
    var(--pc-accent),
    hsl(calc(var(--pc-hue) + 60) 75% 60%),
    hsl(calc(var(--pc-hue) + 120) 70% 60%),
    var(--pc-accent)
  );
}
.pc__ring.is-2fa {
  background: conic-gradient(from 200deg, rgb(var(--v-theme-success)), #7be0b0, rgb(var(--v-theme-success)));
}
.pc__av {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  border: 3px solid rgb(var(--v-theme-surface));
  border-radius: 50%;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.35rem;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--pc-accent), hsl(calc(var(--pc-hue) + 40) 70% 40%));
}
.pc.is-suspended .pc__ring,
.pc.is-suspended .pc__av {
  filter: grayscale(1);
}

.pc__id {
  padding: 0.65rem 0.7rem 0;
  min-width: 0;
}
.pc__name {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 700;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pc__mail {
  margin: 0.15rem 0 0;
  font-size: var(--tvz-fs-small);
  color: rgba(var(--v-theme-on-surface), 0.6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pc__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  padding: 0.6rem 0.7rem 0.9rem;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.16rem 0.5rem;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.07);
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.tag--err {
  background: rgba(var(--v-theme-error), 0.16);
  color: rgb(var(--v-theme-error));
}
.tag--warn {
  background: rgba(var(--v-theme-warning), 0.16);
  color: rgb(var(--v-theme-warning));
}
.tag--infl {
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
  letter-spacing: 0.03em;
}
.tag--infl.is-off {
  background: rgba(var(--v-theme-warning), 0.14);
  color: rgb(var(--v-theme-warning));
}
.tag--role {
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}

/* Stats: a recessed panel, value on top, label under it. */
.pc__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: auto 0 0;
  border-radius: calc(var(--pc-r) - 0.45rem);
  background: rgba(var(--v-theme-on-surface), 0.045);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08);
}
.pc__stats > div {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  padding: 0.75rem 0.3rem;
  min-width: 0;
}
.pc__stats > div + div {
  border-left: 1px solid var(--tvz-hairline);
}
.pc__stats dd {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  margin: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.3rem;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.pc__stats dt {
  max-width: 100%;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Icon strip: last sign-in, 2FA, registered. */
.pc__foot {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 0.45rem;
}
.pc__foot > span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  min-width: 0;
  padding: 0.55rem 0.2rem 0.35rem;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.6);
  white-space: nowrap;
}
.pc__foot > span + span {
  border-left: 1px solid var(--tvz-hairline);
}
.pc__foot > span.is-on {
  color: rgb(var(--v-theme-success));
  font-weight: 600;
}
@media (prefers-reduced-motion: reduce) {
  .pc:hover,
  .pc:focus-visible {
    transform: none;
  }
}
</style>
