import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { SidebarNavGroup } from '@/components/AppSidebar.vue'

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

  const groups = computed<SidebarNavGroup[]>(() => [
    {
      items: [{ to: { name: 'dashboard' }, label: t('nav.dashboard'), icon: 'mdi-view-dashboard-outline' }],
    },
    {
      label: t('nav.manage'),
      items: [
        { to: { name: 'leads' }, label: t('nav.leads'), icon: 'mdi-inbox-arrow-down-outline' },
        { to: { name: 'campaign' }, label: t('nav.campaign'), icon: 'mdi-bullhorn-outline' },
        { to: { name: 'wallet' }, label: t('nav.wallet'), icon: 'mdi-wallet-outline' },
        { to: { name: 'invoices' }, label: t('nav.invoices'), icon: 'mdi-receipt-text-outline' },
        { to: { name: 'support' }, label: t('nav.support'), icon: 'mdi-lifebuoy' },
      ],
    },
  ])

  return { groups }
}
