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
        @update:model-value="admin.setFilter('role', $event as PlatformRole | null)"
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
          <header class="pc__head">
            <span class="pc__av">{{ initials(u.name) }}</span>
            <div class="pc__id">
              <h3 class="pc__name">{{ u.name }}</h3>
              <p class="pc__mail">{{ u.email }}</p>
            </div>
            <v-icon icon="mdi-arrow-top-right" size="17" class="pc__go" />
          </header>

          <div class="pc__tags">
            <span v-if="u.status === 'suspended'" class="tag tag--err">
              <v-icon icon="mdi-cancel" size="11" /> {{ t('admin.userStatus.suspended') }}
            </span>
            <span v-if="!u.emailVerified" class="tag tag--warn">
              <v-icon icon="mdi-email-alert-outline" size="11" /> {{ t('admin.userEmailUnverified') }}
            </span>
            <span v-for="r in u.platformRoles" :key="r" class="tag tag--role">{{ r }}</span>
            <span v-if="!u.platformRoles.length && u.status !== 'suspended' && u.emailVerified" class="tag">
              {{ t('admin.userClient') }}
            </span>
          </div>

          <dl class="pc__stats">
            <div>
              <dt>{{ t('admin.colBusinesses') }}</dt>
              <dd>{{ u.companyCount }}</dd>
            </div>
            <div>
              <dt>{{ t('admin.colAdsCampaigns') }}</dt>
              <dd>{{ u.adsCampaignCount }}</dd>
            </div>
            <div>
              <dt>{{ t('admin.colWallet') }}</dt>
              <dd>
                <v-icon v-if="u.walletBlocked" icon="mdi-lock" size="13" color="error" :title="t('admin.walletFrozen')" />
                {{ credits(u.walletCredits) }}
              </dd>
            </div>
          </dl>

          <footer class="pc__foot">
            <span class="pc__seen">
              <v-icon icon="mdi-clock-outline" size="13" />
              {{ u.lastLoginAt ? t('admin.lastSeenOn', { date: lastLogin(u.lastLoginAt) }) : t('admin.neverSignedIn') }}
            </span>
            <span class="pc__2fa" :class="{ on: u.twoFactorEnabled }" :title="t('admin.stat.users2fa')">
              <v-icon :icon="u.twoFactorEnabled ? 'mdi-shield-check' : 'mdi-shield-off-outline'" size="13" /> 2FA
            </span>
          </footer>
          <p class="pc__joined">{{ t('admin.joinedOn', { date: joined(u.createdAt) }) }}</p>
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

/* Profile card */
.pc {
  --pc-accent: hsl(var(--pc-hue) 70% 55%);
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1.1rem 1.1rem 0.9rem;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-lg);
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
  cursor: pointer;
  transition:
    transform var(--tvz-dur-fast) var(--tvz-ease-out),
    border-color var(--tvz-dur-fast) var(--tvz-ease-out),
    box-shadow var(--tvz-dur-fast) var(--tvz-ease-out);
}
/* A soft band of the person's colour behind the avatar. */
.pc::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 4.2rem;
  background: linear-gradient(
    135deg,
    hsl(var(--pc-hue) 70% 55% / 0.22),
    hsl(calc(var(--pc-hue) + 40) 70% 55% / 0.05)
  );
  pointer-events: none;
}
.pc:hover,
.pc:focus-visible {
  outline: none;
  transform: translateY(-2px);
  border-color: rgba(var(--v-theme-primary), 0.45);
  box-shadow: var(--tvz-shadow-md);
}
.pc.is-suspended {
  border-color: rgba(var(--v-theme-error), 0.45);
}
.pc.is-suspended::before {
  background: linear-gradient(135deg, rgba(var(--v-theme-error), 0.18), transparent);
}
.pc__head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.8rem;
}
.pc__av {
  display: grid;
  place-items: center;
  flex: none;
  width: 3.25rem;
  height: 3.25rem;
  clip-path: var(--tvz-hex-md);
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: var(--tvz-fs-lead);
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--pc-accent), hsl(calc(var(--pc-hue) + 40) 70% 42%));
}
.pc.is-suspended .pc__av {
  filter: grayscale(1);
  opacity: 0.7;
}
.pc__id {
  flex: 1;
  min-width: 0;
}
.pc__name {
  margin: 0;
  font-size: var(--tvz-fs-section);
  font-weight: 700;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pc__mail {
  margin: 0.1rem 0 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.58);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pc__go {
  align-self: flex-start;
  color: rgba(var(--v-theme-on-surface), 0.3);
  transition: color var(--tvz-dur-fast) var(--tvz-ease-out);
}
.pc:hover .pc__go,
.pc:focus-visible .pc__go {
  color: rgb(var(--v-theme-primary));
}
.pc__tags {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.12rem 0.45rem;
  clip-path: var(--tvz-hex-xs);
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
.tag--role {
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}
.pc__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: auto 0 0;
  border: 1px solid var(--tvz-hairline);
  border-radius: var(--tvz-radius-md);
  background: rgba(var(--v-theme-on-surface), 0.025);
}
.pc__stats > div {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
  padding: 0.55rem 0.3rem;
  min-width: 0;
}
.pc__stats > div + div {
  border-left: 1px solid var(--tvz-hairline);
}
.pc__stats dt {
  max-width: 100%;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(var(--v-theme-on-surface), 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pc__stats dd {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  margin: 0;
  font-family: 'Space Grotesk Variable', sans-serif;
  font-size: 1.15rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.pc__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.62);
}
.pc__seen {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-width: 0;
}
.pc__2fa {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  flex: none;
  padding: 0.1rem 0.4rem;
  clip-path: var(--tvz-hex-xs);
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  background: rgba(var(--v-theme-on-surface), 0.07);
}
.pc__2fa.on {
  background: rgba(var(--v-theme-success), 0.16);
  color: rgb(var(--v-theme-success));
}
.pc__joined {
  margin: -0.45rem 0 0;
  font-size: var(--tvz-fs-caption);
  color: rgba(var(--v-theme-on-surface), 0.42);
}
@media (prefers-reduced-motion: reduce) {
  .pc:hover,
  .pc:focus-visible {
    transform: none;
  }
}
</style>
