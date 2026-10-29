import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { SidebarNavGroup } from '@/components/AppSidebar.vue'
import { useAuthStore } from '@/stores/auth'

/** The admin area's sidebar navigation — mirrors useUserNavGroups. Items are
 *  filtered by the signed-in staff member's platform role: a Contabil
 *  (`finance` role, no `admin`) only ever sees the Financiar group + Facturi,
 *  matching what the backend actually lets them call. */
export function useAdminNavGroups() {
  const { t } = useI18n()
  const auth = useAuthStore()
  const isAdmin = computed(() => auth.user?.platformRoles.includes('admin') ?? false)
  // The support queue is open to `support` agents too, not just admins —
  // gating its link on `isAdmin` left a support-only agent with no way into
  // the queue from the admin sidebar at all.
  const isSupportStaff = computed(() => auth.isSupportStaff)
  // Mirror of the above for the Financiar group: it used to carry no role
  // condition at all, so a `support`-only / `moderator`-only staffer was shown
  // all five finance links even though every one of them 403s/bounces for them.
  const isFinanceStaff = computed(() => auth.isFinanceStaff)

  const groups = computed<SidebarNavGroup[]>(() => {
    const all: SidebarNavGroup[] = [
      {
        label: t('admin.navGroupOverview'),
        items: isAdmin.value
          ? [{ to: { name: 'admin-dashboard' }, label: t('admin.navDashboard'), icon: 'mdi-view-dashboard-outline' }]
          : [],
      },
      {
        label: t('admin.navGroupManage'),
        items: [
          ...(isAdmin.value
            ? [
                { to: { name: 'admin-users' }, label: t('admin.navUsers'), icon: 'mdi-account-multiple-outline' },
                { to: { name: 'admin-businesses' }, label: t('admin.navBusinesses'), icon: 'mdi-domain' },
              ]
            : []),
          // Recomandări is `admin`+`finance` on the backend (`GET
          // /admin/referrals` and `/referrals/export`), but this link used to
          // sit inside the admin-only block above — a Contabil had no way
          // into a page the API had deliberately opened to them.
          ...(isFinanceStaff.value
            ? [{ to: { name: 'admin-referrals' }, label: t('admin.navReferrals'), icon: 'mdi-account-multiple-plus-outline' }]
            : []),
          ...(isAdmin.value
            ? [{ to: { name: 'admin-categories' }, label: t('admin.navCategories'), icon: 'mdi-shape-outline' }]
            : []),
          ...(isSupportStaff.value
            ? [{ to: { name: 'support' }, label: t('admin.navSupport'), icon: 'mdi-face-agent' }]
            : []),
        ],
      },
      {
        label: t('admin.navGroupFinance'),
        items: isFinanceStaff.value
          ? [
              { to: { name: 'admin-financiar' }, label: t('admin.navFinanceDashboard'), icon: 'mdi-finance' },
              { to: { name: 'admin-financiar-venituri' }, label: t('admin.navFinanceRevenue'), icon: 'mdi-cash-plus' },
              { to: { name: 'admin-financiar-costuri' }, label: t('admin.navFinanceExpenses'), icon: 'mdi-cash-minus' },
              { to: { name: 'admin-financiar-ai' }, label: t('admin.navFinanceAi'), icon: 'mdi-robot-outline' },
              { to: { name: 'admin-invoices' }, label: t('admin.navInvoices'), icon: 'mdi-receipt-text-outline' },
            ]
          : [],
      },
      {
        label: t('admin.navGroupConfig'),
        // `GET /admin/settings` is `admin`+`finance`: the VAT rate, refund
        // fee, FX rate and invoice-issuer identity are what a Contabil
        // reconciles against. The view itself hides every write control for
        // a finance-only viewer, so the link is safe to show them.
        items: isFinanceStaff.value
          ? [{ to: { name: 'admin-settings' }, label: t('admin.navSettings'), icon: 'mdi-tune-variant' }]
          : [],
      },
    ]
    return all.filter((g) => g.items.length > 0)
  })

  return { groups }
}
