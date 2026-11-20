<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDisplay } from 'vuetify'
import { storeToRefs } from 'pinia'

import { useRoute, useRouter } from 'vue-router'

import { useCompanySwitch } from '@/composables/useCompanySwitch'
import { useUiStore } from '@/stores/ui'
import { useCompaniesStore } from '@/stores/companies'
import { useGoogleAdsUserStore } from '@/stores/googleAdsUser'

const { t } = useI18n()
const { mdAndUp } = useDisplay()
const ui = useUiStore()
const companies = useCompaniesStore()
const { overview, currentId } = storeToRefs(companies)
const { pickCompany } = useCompanySwitch()
const ads = useGoogleAdsUserStore()
const route = useRoute()
const router = useRouter()

/** A Google Ads campaign's dashboard is open: it is the active item. */
const currentAds = computed(() =>
  route.name === 'ads-dashboard' ? ads.campaigns.find((c) => c.id === route.params.id) ?? null : null,
)
const ADS_TONE: Record<string, string> = { active: 'live', paused: 'idle', disconnected: 'error' }

const menuOpen = ref(false)

const STATUS_TONE: Record<string, string> = {
  active: 'live',
  draft: 'idle',
  suspended: 'error',
}

/** Same resolution every company-scoped page already uses (see
 *  `companies.resolveId`) — sticky selection, else the first. */
const current = computed(() => companies.currentOverview)

function select(id: string): void {
  menuOpen.value = false
  if (!mdAndUp.value) ui.closeSidebar()
  pickCompany(id)
  // Leaving a Google Ads dashboard for a business: open its panel.
  if (route.name === 'ads-dashboard') void router.push({ name: 'dashboard' })
}
function selectAds(id: string): void {
  menuOpen.value = false
  if (!mdAndUp.value) ui.closeSidebar()
  void router.push({ name: 'ads-dashboard', params: { id } })
}
function goCreate(): void {
  menuOpen.value = false
  if (!mdAndUp.value) ui.closeSidebar()
}

onMounted(() => {
  void companies.fetchOverview().catch(() => {})
  void ads.fetch()
})
</script>

<template>
  <v-menu
    v-if="overview.length || ads.campaigns.length"
    v-model="menuOpen"
    location="bottom start"
    transition="scale-transition"
    :close-on-content-click="false"
  >
    <template #activator="{ props }">
      <button v-bind="props" type="button" class="csw" :class="{ 'is-open': menuOpen }">
        <span class="csw__label">
          <span class="csw__eyebrow">{{ currentAds ? t('nav.adsCampaign') : t('nav.activeCampaign') }}</span>
          <span v-if="currentAds" class="csw__name">
            <v-icon icon="mdi-google-ads" size="14" class="csw__gads" />
            {{ currentAds.name }}
          </span>
          <span v-else class="csw__name">
            <span
              v-if="current"
              class="csw__dot"
              :class="`t-${STATUS_TONE[current.status] || 'idle'}`"
            />
            {{ current?.displayName ?? t('nav.pickCampaign') }}
          </span>
        </span>
        <v-icon icon="mdi-unfold-more-horizontal" size="16" class="csw__chev" />
      </button>
    </template>

    <v-card class="csw__menu" rounded="lg">
      <template v-if="overview.length">
        <p class="csw__menuLabel">{{ t('nav.myBusinesses') }}</p>
        <button
          v-for="c in overview"
          :key="c.id"
          type="button"
          class="csw__item"
          :class="{ 'is-active': !currentAds && c.id === currentId }"
          @click="select(c.id)"
        >
          <span class="csw__dot" :class="`t-${STATUS_TONE[c.status] || 'idle'}`" />
          <span>{{ c.displayName }}</span>
          <v-icon v-if="!currentAds && c.id === currentId" icon="mdi-check" size="15" class="csw__chk" />
        </button>
      </template>
      <RouterLink :to="{ name: 'create' }" class="csw__item csw__item--add" @click="goCreate">
        <v-icon icon="mdi-plus" size="15" />
        <span>{{ t('nav.addBusiness') }}</span>
      </RouterLink>

      <!-- Google Ads campaigns managed by the optimization agent -->
      <p class="csw__menuLabel csw__menuLabel--sep">{{ t('nav.adsCampaigns') }}</p>
      <button
        v-for="c in ads.campaigns"
        :key="c.id"
        type="button"
        class="csw__item"
        :class="{ 'is-active': currentAds?.id === c.id }"
        @click="selectAds(c.id)"
      >
        <span class="csw__dot" :class="`t-${ADS_TONE[c.status] || 'idle'}`" />
        <span>{{ c.name }}</span>
        <span v-if="c.pendingApprovals" class="csw__badge">{{ c.pendingApprovals }}</span>
        <v-icon v-if="currentAds?.id === c.id" icon="mdi-check" size="15" class="csw__chk" />
      </button>
      <RouterLink
        :to="{ name: ads.campaigns.length ? 'ads-connections' : 'ads-connect' }"
        class="csw__item csw__item--add"
        @click="goCreate"
      >
        <v-icon icon="mdi-google-ads" size="15" />
        <span>{{ t('nav.addAdsCampaign') }}</span>
      </RouterLink>
    </v-card>
  </v-menu>
</template>

<style scoped>
.csw {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.65rem;
  border-radius: 10px;
  border: 1px solid var(--tvz-hairline);
  background: rgb(var(--v-theme-surface));
  cursor: pointer;
  transition:
    border-color var(--tvz-dur-fast) var(--tvz-ease-out),
    background var(--tvz-dur-fast) var(--tvz-ease-out);
}
.csw:hover,
.csw.is-open {
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-color: rgba(var(--v-theme-on-surface), 0.18);
}
.csw__label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  text-align: left;
}
.csw__eyebrow {
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.42);
}
.csw__name {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: var(--tvz-fs-body);
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.csw__gads {
  flex: none;
  color: rgb(var(--v-theme-primary));
}
.csw__chev {
  flex: none;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.csw__dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), 0.32);
}
.csw__dot.t-live {
  background: rgb(var(--v-theme-success));
  box-shadow: 0 0 0 2px rgba(var(--v-theme-success), 0.18);
}
.csw__dot.t-error {
  background: rgb(var(--v-theme-error));
}
</style>

<style>
/* Teleported overlay content — theme tokens only, same convention as
   SidebarModeSwitch's own menu and the account menu in AppBar.vue. */
.csw__menu {
  width: 15rem;
  padding: 0.35rem;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  box-shadow: var(--tvz-shadow-lg);
}
.csw__menuLabel {
  margin: 0.3rem 0.55rem 0.4rem;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.csw__item {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  padding: 0.55rem 0.6rem;
  border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.85);
  text-decoration: none;
  font-size: var(--tvz-fs-body);
  font-weight: 500;
  text-align: left;
  transition: background 0.14s ease;
}
.csw__item:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.csw__item.is-active {
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}
.csw__item span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csw__item--add {
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}
.csw__chk {
  flex: none !important;
  color: rgb(var(--v-theme-primary));
}
.csw__menuLabel--sep {
  margin-top: 0.6rem;
  padding-top: 0.6rem;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.csw__badge {
  flex: none !important;
  min-width: 1.2rem;
  padding: 0 0.3rem;
  border-radius: 999px;
  font-size: var(--tvz-fs-micro);
  font-weight: 700;
  text-align: center;
  color: #fff;
  background: rgb(var(--v-theme-warning));
}
</style>
