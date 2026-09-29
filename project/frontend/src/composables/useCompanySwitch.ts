import { useRoute, useRouter } from 'vue-router'

import { useCompaniesStore } from '@/stores/companies'

/** Routes that read `?c=` for their active company (see `resolveId` callers
 *  across the app: dashboard/leads/appointments/campaign/wallet/invoices/
 *  the builders) — switching business on one of these stays on the same
 *  page and just swaps the company, so it's obvious the page's content
 *  (requests, appointments, campaign, ...) follows the selection. Anywhere
 *  else (feed, account, support, ...) falls back to the dashboard. */
const COMPANY_SCOPED_ROUTES = new Set([
  'dashboard',
  'wallet',
  'wallet-transactions',
  'campaign',
  'campaign-budget',
  'campaign-optimize',
  'campaign-spend',
  'leads',
  'appointments',
  'consumption',
  'invoices',
  'website-builder',
  'easy-site-editor',
])

/** Shared "pick a different active business" behavior for every company
 *  switcher in the app (the account-menu list, the sidebar selector, ...) —
 *  one place so they can never drift out of sync with each other. */
export function useCompanySwitch() {
  const route = useRoute()
  const router = useRouter()
  const companies = useCompaniesStore()

  function pickCompany(id: string): void {
    companies.select(id)
    const name =
      typeof route.name === 'string' && COMPANY_SCOPED_ROUTES.has(route.name)
        ? route.name
        : 'dashboard'
    void router.push({ name, query: { ...route.query, c: id } })
  }

  return { pickCompany }
}
