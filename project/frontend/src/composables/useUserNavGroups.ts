import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { SidebarNavGroup } from '@/components/AppSidebar.vue'
import { useCompaniesStore } from '@/stores/companies'

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
  const current = computed(() => companies.currentOverview)

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

  const groups = computed<SidebarNavGroup[]>(() => [
    {
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
    },
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
