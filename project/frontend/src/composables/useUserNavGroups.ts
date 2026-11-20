import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { SidebarNavGroup, SidebarNavItem } from '@/components/AppSidebar.vue'
import { useRoute } from 'vue-router'

import { useCompaniesStore } from '@/stores/companies'
import { useGoogleAdsUserStore } from '@/stores/googleAdsUser'

/**
 * The signed-in user's panel navigation, grouped for the left sidebar.
 * Single source of truth — was previously duplicated as flat arrays inside
 * AppBar's account dropdown.
 *
 * Staff-only tools (the admin area, the support queue) deliberately don't
 * appear here — the persistent mode switch pinned above this list is the
 * one way in, so a staff member never sees the same destination listed
 * twice under two different names.
 */
export function useUserNavGroups() {
  const { t } = useI18n()
  const companies = useCompaniesStore()
  const ads = useGoogleAdsUserStore()
  const route = useRoute()
  const current = computed(() => companies.currentOverview)

  // A Google Ads campaign selected in the panel's switcher: its dedicated
  // dashboard replaces the business pages in the sidebar.
  const adsCampaignId = computed(() =>
    route.name === 'ads-dashboard' ? String(route.params.id) : null,
  )
  const adsGroup = computed<SidebarNavGroup | null>(() => {
    const id = adsCampaignId.value
    if (!id) return null
    const pending = ads.campaigns.find((c) => c.id === id)?.pendingApprovals ?? 0
    const item = (tab: string, label: string, icon: string, extra: Partial<SidebarNavItem> = {}) => ({
      to: { name: 'ads-dashboard', params: { id }, query: { tab } },
      label,
      icon,
      tab: { value: tab, default: tab === 'overview' },
      ...extra,
    })
    return {
      label: t('nav.adsGroup'),
      items: [
        item('overview', t('ads.tab.overview'), 'mdi-view-dashboard-outline'),
        item('agent', t('ads.tab.agent'), 'mdi-robot-outline'),
        item('proposals', t('ads.tab.proposals'), 'mdi-account-check-outline', pending ? { badge: pending } : {}),
        item('settings', t('ads.tab.settings'), 'mdi-tune-variant'),
        item('costs', t('ads.tab.costs'), 'mdi-cash-multiple'),
        { to: { name: 'ads-connections' }, label: t('nav.adsConnections'), icon: 'mdi-google' },
      ],
    }
  })

  // No website at all, or an advanced-plan site that was never unlocked —
  // there's no live site for a visitor to submit a form on. Before overview
  // has loaded even once, default to showing it rather than flashing it
  // away — but a *loaded, empty* overview (no business at all yet) must
  // fail closed, not open.
  const showLeads = computed(() => {
    if (!companies.overviewLoaded) return true
    const c = current.value
    if (!c || !c.website) return false
    if (c.website.mode === 'advanced' && !c.builderUnlocked) return false
    return true
  })
  // Appointments is strictly opt-in (see AppointmentsView's own toggle, also
  // surfaced in Website settings) — hide the page until it's actually been
  // turned on, same "daca nu e setat" rule as Leads.
  const showAppointments = computed(() => {
    if (!companies.overviewLoaded) return true
    return current.value?.appointmentsEnabled ?? false
  })

  // Overview loaded and genuinely empty: the user has no business yet. Every
  // business-scoped page would just bounce back to the dashboard (the router
  // guard sends them there), so don't list them at all, point at the one
  // thing that unlocks them instead.
  const noBusiness = computed(() => companies.overviewLoaded && companies.overview.length === 0)

  const businessGroup = computed<SidebarNavGroup>(() =>
    noBusiness.value
      ? {
          items: [
            {
              to: { name: 'dashboard' },
              label: t('nav.dashboard'),
              icon: 'mdi-view-dashboard-outline',
            },
            {
              to: { name: 'create' },
              label: t('nav.createBusiness'),
              icon: 'mdi-plus-circle-outline',
            },
          ],
        }
      : businessPages.value,
  )

  const businessPages = computed<SidebarNavGroup>(() => ({
    // Business/campaign-specific pages: whichever company the sidebar's own
    // campaign switcher (SidebarCampaignSwitch) currently has selected.
    items: [
      { to: { name: 'dashboard' }, label: t('nav.dashboard'), icon: 'mdi-view-dashboard-outline' },
      ...(showLeads.value
        ? [{ to: { name: 'leads' }, label: t('nav.leads'), icon: 'mdi-inbox-arrow-down-outline' }]
        : []),
      ...(showAppointments.value
        ? [
            {
              to: { name: 'appointments' },
              label: t('nav.appointments'),
              icon: 'mdi-calendar-check-outline',
            },
          ]
        : []),
      { to: { name: 'campaign' }, label: t('nav.campaign'), icon: 'mdi-bullhorn-outline' },
      {
        to: { name: 'consumption' },
        label: t('nav.consumption'),
        icon: 'mdi-chart-donut',
      },
      {
        to: { name: 'location' },
        label: t('nav.location'),
        icon: 'mdi-map-marker-outline',
      },
      {
        to: { name: 'category' },
        label: t('nav.category'),
        icon: 'mdi-shape-outline',
      },
      {
        to: { name: 'website-settings' },
        label: t('nav.websiteSettings'),
        icon: 'mdi-cog-outline',
      },
    ],
  }))

  const groups = computed<SidebarNavGroup[]>(() => [
    adsGroup.value ?? businessGroup.value,
    {
      // General account pages — not tied to any one business, so they stay
      // put regardless of which company is active above.
      items: [
        { to: { name: 'wallet' }, label: t('nav.wallet'), icon: 'mdi-wallet-outline' },
        {
          to: { name: 'wallet-transactions' },
          label: t('nav.payments'),
          icon: 'mdi-swap-horizontal',
        },
        { to: { name: 'invoices' }, label: t('nav.invoices'), icon: 'mdi-receipt-text-outline' },
        { to: { name: 'support' }, label: t('nav.support'), icon: 'mdi-lifebuoy' },
      ],
    },
  ])

  return { groups }
}
