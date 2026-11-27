import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import type { SidebarNavGroup, SidebarNavItem } from '@/components/AppSidebar.vue'
import { useCompaniesStore } from '@/stores/companies'
import { useGoogleAdsUserStore } from '@/stores/googleAdsUser'
import { useWorkspaceStore } from '@/stores/workspace'

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
  const workspace = useWorkspaceStore()
  const route = useRoute()
  const current = computed(() => companies.currentOverview)

  // Google Ads area: its own pages plus, once a campaign is selected, the
  // pages of that campaign. Nothing of the business panel shows here.
  const adsGroups = computed<SidebarNavGroup[]>(() => {
    const groups: SidebarNavGroup[] = [
      {
        items: [
          { to: { name: 'ads-home' }, label: t('nav.adsAll'), icon: 'mdi-view-list-outline' },
          {
            to: { name: 'ads-connections' },
            label: t('nav.adsConnections'),
            icon: 'mdi-google',
            activeMatch: ['ads-connection-add'],
          },
          { to: { name: 'ads-costs' }, label: t('nav.adsCosts'), icon: 'mdi-cash-multiple' },
        ],
      },
    ]
    const c = ads.selected
    if (!c) return groups
    const item = (tab: string, icon: string, extra: Partial<SidebarNavItem> = {}): SidebarNavItem => ({
      to: { name: 'ads-dashboard', params: { id: c.id }, query: { tab } },
      label: t(`ads.tab.${tab}`),
      icon,
      tab: { value: tab, default: tab === 'home', route: 'ads-dashboard' },
      ...extra,
    })
    groups.push({
      label: t('nav.adsSelected'),
      items: [
        item('home', 'mdi-home-outline'),
        item('chat', 'mdi-chat-outline'),
        item('proposals', 'mdi-account-check-outline', c.pendingApprovals ? { badge: c.pendingApprovals } : {}),
        item('history', 'mdi-history'),
        item('settings', 'mdi-tune-variant'),
        item('overview', 'mdi-chart-box-outline'),
      ],
    })
    return groups
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

  const influencerGroup = computed<SidebarNavGroup>(() => ({
    items: [{ to: { name: 'influencer' }, label: t('nav.influencerPanel'), icon: 'mdi-chart-box-outline' }],
  }))

  const groups = computed<SidebarNavGroup[]>(() => [
    ...(route.path.startsWith('/influencer')
      ? [influencerGroup.value]
      : workspace.id === 'ads'
        ? adsGroups.value
        : [businessGroup.value]),
    {
      // General account pages — not tied to any one business, so they stay
      // put regardless of which company is active above.
      items: [
        { to: { name: 'wallet' }, label: t('nav.wallet'), icon: 'mdi-wallet-outline' },
        {
          to: { name: 'wallet-transactions' },
          // Named after the page it opens ("Tranzacții"); "Plăți" is the
          // wallet's own payment-history tab, a different list.
          label: t('nav.transactions'),
          icon: 'mdi-swap-horizontal',
        },
        { to: { name: 'invoices' }, label: t('nav.invoices'), icon: 'mdi-receipt-text-outline' },
        { to: { name: 'support' }, label: t('nav.support'), icon: 'mdi-lifebuoy' },
      ],
    },
  ])

  return { groups }
}
