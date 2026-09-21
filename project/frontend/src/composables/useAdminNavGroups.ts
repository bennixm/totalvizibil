import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { SidebarNavGroup } from '@/components/AppSidebar.vue'

/** The admin area's sidebar navigation — mirrors useUserNavGroups. */
export function useAdminNavGroups() {
  const { t } = useI18n()

  const groups = computed<SidebarNavGroup[]>(() => [
    {
      label: t('admin.navGroupOverview'),
      items: [
        { to: { name: 'admin-dashboard' }, label: t('admin.navDashboard'), icon: 'mdi-view-dashboard-outline' },
      ],
    },
    {
      label: t('admin.navGroupManage'),
      items: [
        { to: { name: 'admin-users' }, label: t('admin.navUsers'), icon: 'mdi-account-multiple-outline' },
        { to: { name: 'admin-businesses' }, label: t('admin.navBusinesses'), icon: 'mdi-domain' },
        { to: { name: 'admin-invoices' }, label: t('admin.navInvoices'), icon: 'mdi-receipt-text-outline' },
        { to: { name: 'admin-categories' }, label: t('admin.navCategories'), icon: 'mdi-shape-outline' },
        { to: { name: 'support' }, label: t('admin.navSupport'), icon: 'mdi-face-agent' },
      ],
    },
    {
      label: t('admin.navGroupConfig'),
      items: [{ to: { name: 'admin-settings' }, label: t('admin.navSettings'), icon: 'mdi-tune-variant' }],
    },
  ])

  return { groups }
}
