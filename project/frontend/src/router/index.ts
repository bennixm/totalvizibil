import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalized,
  type RouteRecordRaw,
} from 'vue-router'

import { i18n } from '@/plugins/i18n'
import { useAuthStore } from '@/stores/auth'
import { useConfirmStore } from '@/stores/confirm'
import { useMoneyStore } from '@/stores/money'
import { useUiStore } from '@/stores/ui'

const routes: RouteRecordRaw[] = [
  // --- Discovery (public) ---
  { path: '/', name: 'feed', component: () => import('@/views/FeedView.vue') },
  // Legacy prefixed SEO paths — permanently redirect to the flat `browse` path
  // (see its own route below) so any bookmarked/indexed link keeps working.
  { path: '/feed', redirect: { name: 'feed' } },
  {
    path: '/feed/:group/:niche?',
    redirect: (to) => {
      const params: Record<string, string> = { seg1: to.params.group as string }
      if (to.params.niche) params.seg2 = to.params.niche as string
      return { name: 'browse', params }
    },
  },
  {
    path: '/c/:crumbs+',
    redirect: (to) => {
      const c = to.params.crumbs
      const [seg1, seg2, seg3] = (Array.isArray(c) ? c : [c]) as string[]
      const params: Record<string, string> = { seg1 }
      if (seg2) params.seg2 = seg2
      if (seg3) params.seg3 = seg3
      return { name: 'browse', params }
    },
  },

  // --- Create your business ---
  { path: '/create', name: 'create', component: () => import('@/views/CreateBusinessView.vue') },
  {
    path: '/create/easy',
    name: 'create-easy',
    component: () => import('@/views/CreateEasyStudioView.vue'),
  },
  {
    path: '/create/location',
    name: 'create-location',
    component: () => import('@/views/CreateLocationView.vue'),
  },
  {
    path: '/create/advanced',
    name: 'create-advanced',
    component: () => import('@/views/CreateAdvancedInfoView.vue'),
  },
  {
    path: '/create/account',
    name: 'create-account',
    component: () => import('@/views/CreateAccountView.vue'),
  },
  {
    // Advanced-plan only: the one-time "unlock the advanced builder" payment
    // step. A standalone flow step — deliberately NOT a pay screen embedded in
    // the Website Builder itself, so the stepper's sequencing never leaks in.
    path: '/create/unlock',
    name: 'create-unlock',
    component: () => import('@/views/CreateUnlockView.vue'),
    meta: { requiresAuth: true },
  },

  // --- Business dashboard ---
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { requiresAuth: true, panel: true },
  },
  {
    path: '/wallet',
    name: 'wallet',
    component: () => import('@/views/WalletView.vue'),
    meta: { requiresAuth: true, panel: true },
  },
  {
    path: '/wallet/transactions',
    name: 'wallet-transactions',
    component: () => import('@/views/TransactionsView.vue'),
    meta: { requiresAuth: true, panel: true },
  },
  {
    // The campaign hub — consumption stats + status + activate/stop, with links
    // out to the optimiser and the budget/CPC editor.
    path: '/campaign',
    name: 'campaign',
    component: () => import('@/views/CampaignSpendView.vue'),
    meta: { requiresAuth: true, panel: true },
  },
  {
    path: '/campaign/budget',
    name: 'campaign-budget',
    component: () => import('@/views/CampaignView.vue'),
    meta: { requiresAuth: true, panel: true },
  },
  {
    path: '/campaign/optimize',
    name: 'campaign-optimize',
    component: () => import('@/views/CampaignOptimizeView.vue'),
    meta: { requiresAuth: true, panel: true },
  },
  // The old dedicated spend page is now the hub itself.
  {
    path: '/campaign/spend',
    name: 'campaign-spend',
    redirect: (to) => ({ name: 'campaign', query: to.query }),
  },
  {
    path: '/consumption',
    name: 'consumption',
    component: () => import('@/views/ConsumptionView.vue'),
    meta: { requiresAuth: true, panel: true },
  },
  {
    // Edit an existing business's service area — a panel page like the rest.
    // The pre-account onboarding step (/create/location) is a separate flow.
    path: '/location',
    name: 'location',
    component: () => import('@/views/LocationView.vue'),
    meta: { requiresAuth: true, panel: true },
  },
  {
    // Edit an existing business's category tagging — split out from
    // location so each is independently editable.
    path: '/category',
    name: 'category',
    component: () => import('@/views/CategoryView.vue'),
    meta: { requiresAuth: true, panel: true },
  },
  {
    path: '/leads',
    name: 'leads',
    component: () => import('@/views/LeadsView.vue'),
    meta: { requiresAuth: true, panel: true },
  },
  {
    path: '/appointments',
    name: 'appointments',
    component: () => import('@/views/AppointmentsView.vue'),
    meta: { requiresAuth: true, panel: true },
  },
  {
    path: '/invoices',
    name: 'invoices',
    component: () => import('@/views/InvoicesView.vue'),
    meta: { requiresAuth: true, panel: true },
  },

  // --- Support ---
  {
    path: '/support',
    name: 'support',
    component: () => import('@/views/SupportView.vue'),
    meta: { requiresAuth: true, panel: true },
  },
  {
    path: '/support/new',
    name: 'support-new',
    component: () => import('@/views/SupportNewView.vue'),
    meta: { requiresAuth: true, panel: true },
  },
  {
    path: '/support/:id',
    name: 'support-ticket',
    component: () => import('@/views/SupportTicketView.vue'),
    meta: { requiresAuth: true, panel: true },
  },
  {
    // The Website Builder: an AI chat that writes a real Vue/Vite project and
    // runs it live via WebContainer. Same `?c=` company-id convention as the
    // rest of the Advanced flow. Gated server-side by the same one-time paid
    // "advanced unlock" the Advanced business-creation flow charges for.
    path: '/website/builder',
    name: 'website-builder',
    component: () => import('@/views/WebsiteBuilderView.vue'),
    meta: { requiresAuth: true },
  },
  {
    // Simple-plan only: post-account editor for a claimed "Site Simplu" website.
    // Same guided widgets as setup, editing the live site in place.
    path: '/website/simple',
    name: 'easy-site-editor',
    component: () => import('@/views/EasySiteEditorView.vue'),
    meta: { requiresAuth: true },
  },
  {
    // Website settings — NOT the editor: file export, custom domain. Links
    // out into the real editor instead of embedding it.
    path: '/website/settings',
    name: 'website-settings',
    component: () => import('@/views/WebsiteSettingsView.vue'),
    meta: { requiresAuth: true, panel: true },
  },

  // --- Account & auth ---
  {
    path: '/account',
    name: 'account',
    component: () => import('@/views/AccountView.vue'),
    meta: { requiresAuth: true, panel: true },
  },
  {
    path: '/account/invoices/:id',
    name: 'invoice-print',
    component: () => import('@/views/InvoicePrintView.vue'),
    meta: { requiresAuth: true },
  },
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { guestOnly: true } },
  {
    path: '/forgot-password',
    name: 'forgot-password',
    component: () => import('@/views/ForgotPasswordView.vue'),
    meta: { guestOnly: true },
  },
  {
    path: '/reset-password',
    name: 'reset-password',
    component: () => import('@/views/ResetPasswordView.vue'),
    meta: { guestOnly: true },
  },
  {
    path: '/admin',
    component: () => import('@/views/admin/AdminLayout.vue'),
    meta: { requiresAuth: true, requiresPlatformStaff: true },
    // NOTE: there is deliberately no `{ path: '' }` child with a role-aware
    // `redirect` here any more. A route-record `redirect` is resolved by
    // vue-router BEFORE `beforeEach` runs — i.e. before `auth.bootstrap()` —
    // so on a cold hard-refresh or bookmark of `/admin`, `auth.user` was
    // still null, every role check fell through to the `account` fallback,
    // and even a full admin got ejected to /account. (In-session client-side
    // navigation worked, because auth was already warm — which is exactly
    // why it was easy to miss.) The dispatch now lives in the guard below,
    // keyed on `to.path === '/admin'`, after bootstrap has resolved.
    children: [
      {
        path: 'dashboard',
        name: 'admin-dashboard',
        component: () => import('@/views/admin/AdminDashboardView.vue'),
      },
      {
        path: 'users',
        name: 'admin-users',
        component: () => import('@/views/admin/AdminUsersView.vue'),
      },
      {
        path: 'users/:id',
        name: 'admin-user',
        // Reachable from the Facturi table (every invoice row links the buyer),
        // which a Contabil can open — without `finance` here, clicking a buyer
        // name ejected them straight to /account.
        meta: { allowedRoles: ['admin', 'finance'] },
        component: () => import('@/views/admin/AdminUserDetailView.vue'),
      },
      {
        path: 'businesses',
        name: 'admin-businesses',
        component: () => import('@/views/admin/AdminBusinessesView.vue'),
      },
      {
        path: 'categories',
        name: 'admin-categories',
        component: () => import('@/views/admin/AdminCategoriesView.vue'),
      },
      {
        path: 'google-ads-agent',
        name: 'admin-google-ads-agent',
        component: () => import('@/views/admin/AdminGoogleAdsAgentView.vue'),
      },
      {
        path: 'settings',
        name: 'admin-settings',
        // `GET /admin/settings` is `@PlatformRoles('admin','finance')`: a
        // Contabil needs the VAT rate / refund fee / FX rate / invoice-issuer
        // identity to reconcile anything. The view renders those read-only
        // and hides every PATCH control for a finance-only viewer.
        meta: { allowedRoles: ['admin', 'finance'] },
        component: () => import('@/views/admin/AdminSettingsView.vue'),
      },
      {
        path: 'companies/:id',
        name: 'admin-company',
        component: () => import('@/views/admin/AdminCompanyDetailView.vue'),
      },
      {
        path: 'invoices',
        name: 'admin-invoices',
        meta: { allowedRoles: ['admin', 'finance'] },
        component: () => import('@/views/admin/AdminInvoicesView.vue'),
      },
      {
        path: 'referrals',
        name: 'admin-referrals',
        // `GET /admin/referrals` and `/referrals/export` are both
        // `@PlatformRoles('admin','finance')` — the route defaulting to
        // admin-only locked a Contabil out of a page the backend had
        // deliberately opened to them.
        meta: { allowedRoles: ['admin', 'finance'] },
        component: () => import('@/views/admin/AdminReferralsView.vue'),
      },
      {
        path: 'financiar',
        name: 'admin-financiar',
        meta: { allowedRoles: ['admin', 'finance'] },
        component: () => import('@/views/admin/AdminFinanceDashboardView.vue'),
      },
      {
        path: 'financiar/venituri',
        name: 'admin-financiar-venituri',
        meta: { allowedRoles: ['admin', 'finance'] },
        component: () => import('@/views/admin/AdminFinanceRevenueView.vue'),
      },
      {
        path: 'financiar/costuri',
        name: 'admin-financiar-costuri',
        meta: { allowedRoles: ['admin', 'finance'] },
        component: () => import('@/views/admin/AdminFinanceExpensesView.vue'),
      },
      {
        path: 'financiar/ai',
        name: 'admin-financiar-ai',
        meta: { allowedRoles: ['admin', 'finance'] },
        component: () => import('@/views/admin/AdminFinanceAiUsageView.vue'),
      },
      {
        path: 'jurnal',
        name: 'admin-jurnal',
        // `GET /admin/audit-log` is admin-only; `GET /admin/business-action-log`
        // is `admin`+`support` (support needs it for ownership-dispute cases) —
        // the wider of the two, same reasoning as the other split-access pages
        // above. The view itself hides the staff-log tab for a non-admin.
        meta: { allowedRoles: ['admin', 'support'] },
        component: () => import('@/views/admin/AdminJurnalView.vue'),
      },
    ],
  },

  // --- Redirects from the old IA ---
  { path: '/register', redirect: { name: 'create' } },
  { path: '/for-business', redirect: { name: 'create' } },
  { path: '/search', redirect: { name: 'feed' } },
  { path: '/companies/new', redirect: { name: 'create' } },
  { path: '/create/:rest(.*)', redirect: { name: 'create' } },

  // Flat SEO path shared by the category feed and a company's public page —
  // `/group`, `/group/niche`, `/group/niche/slug`, or `/group/slug` for a
  // company filed directly under a top-level group. Every static route above
  // scores higher per-segment than these all-dynamic params, so this only
  // ever catches what nothing else claimed. See `BrowseView.vue` for how it
  // tells a sub-category apart from a company slug.
  {
    path: '/:seg1/:seg2?/:seg3?',
    name: 'browse',
    component: () => import('@/views/BrowseView.vue'),
  },

  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFoundView.vue') },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(_to, _from, savedPosition) {
    return savedPosition ?? { top: 0 }
  },
})

/**
 * Direction 7 (research doc): the in-app-navigation half of the feed exit-
 * confirmation popup — a real browser exit (tab close, refresh, typing
 * another URL) is handled separately by App.vue's `beforeunload` listener,
 * which can't show custom copy. This one can, because it's just a normal
 * (cancellable) in-app navigation.
 *
 * `ui.viewingFeed` (set by `FeedView.vue`'s own mount/unmount) is the single
 * source of truth for "was the user actually looking at the feed listing" —
 * true at `/` and at a category URL, false at a company page even though
 * that can share the same URL prefix (`BrowseView` swaps the component out
 * entirely there). Navigating to another 'feed' or 'browse' URL — picking a
 * different category, or clicking through to a company's own page — is
 * EXACTLY the one thing the spec says must never trigger this popup, and
 * both land on `to.name` 'feed'/'browse' regardless of which of the two it
 * resolves to, so a single name check covers both without needing to
 * duplicate `BrowseView`'s own feed-vs-company resolution here.
 */
let bypassNextExitGuard = false
function guardFeedExit(to: RouteLocationNormalized, from: RouteLocationNormalized): boolean {
  if (bypassNextExitGuard) {
    bypassNextExitGuard = false
    return true
  }
  const ui = useUiStore()
  if (!ui.viewingFeed) return true
  const staysFeedRelated = to.name === 'feed' || to.name === 'browse'
  if (staysFeedRelated) return true
  if (from.name !== 'feed' && from.name !== 'browse') return true // defensive — shouldn't happen

  const confirm = useConfirmStore()
  const { t } = i18n.global
  confirm.ask(
    t('feed.exitConfirmTitle'),
    t('feed.exitConfirmText'),
    () => {
      bypassNextExitGuard = true
      void router.push(to.fullPath)
    },
    { danger: false },
  )
  return false
}

router.beforeEach(async (to, from) => {
  if (!guardFeedExit(to, from)) return false

  // First-touch affiliate attribution: stash a `?ref=CODE` so it survives the
  // sign-up flow. Never overwritten once set — the first link wins.
  const ref = typeof to.query.ref === 'string' ? to.query.ref.trim().slice(0, 32).toUpperCase() : ''
  if (ref) {
    try {
      if (!localStorage.getItem('tvz.ref')) localStorage.setItem('tvz.ref', ref)
    } catch {
      /* storage unavailable — ignore */
    }
  }

  // Google Ads click attribution — unlike `tvz.ref` above, this one DOES get
  // overwritten on every fresh `?gclid=`: a visitor can arrive from Google
  // Ads more than once over weeks, and each arrival should restart its own
  // short attribution window, not keep stamping a feed click against
  // whichever `gclid` happened to land first. The window itself (how old is
  // too old to still count) is enforced at read time, in `services/ads.ts`.
  const gclid = typeof to.query.gclid === 'string' ? to.query.gclid.trim().slice(0, 120) : ''
  if (gclid) {
    try {
      localStorage.setItem('tvz.gclid', gclid)
      localStorage.setItem('tvz.gclid_at', String(Date.now()))
    } catch {
      /* storage unavailable — ignore */
    }
  }

  const auth = useAuthStore()
  if (!auth.ready) await auth.bootstrap()

  // An affiliate link is an invitation to start a business. A guest who lands on
  // the homepage via `?ref=` goes straight into the create flow (the code is
  // already stashed above and gets claimed after they register).
  if (ref && !auth.isAuthenticated && to.name === 'feed') {
    return { name: 'create', query: { ...to.query } }
  }

  // Warm the FX context (display currency + EUR/RON rate) once signed in, so
  // credit amounts render with their equivalent from the first paint.
  if (auth.isAuthenticated) void useMoneyStore().ensureLoaded()

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  // `/admin` is a role-aware dispatch, not a page: land each staff role on
  // the first area it can actually open. Must run BEFORE the role gate below
  // (which defaults to admin-only) so a support-/finance-only staffer isn't
  // bounced to /account on the way to the one page they can use. Lives here
  // rather than in a route-record `redirect` because those resolve before
  // `auth.bootstrap()` above — see the note on the `/admin` record.
  if (to.path === '/admin' || to.path === '/admin/') {
    const roles = auth.user?.platformRoles ?? []
    let home = 'account'
    if (roles.includes('admin')) home = 'admin-dashboard'
    else if (auth.isFinanceStaff) home = 'admin-financiar'
    else if (auth.isSupportStaff) home = 'support'
    return { name: home, query: to.query }
  }

  // `allowedRoles` is enforced on its own, independently of
  // `requiresPlatformStaff`. It used to live INSIDE that branch: every route
  // carrying `allowedRoles` happens to also set the flag today, so nothing
  // was actually open, but a route declaring only `allowedRoles` would have
  // been completely ungated.
  const allowedRoles = to.meta.allowedRoles as string[] | undefined
  if (allowedRoles) {
    const roles = auth.user?.platformRoles ?? []
    if (!roles.some((r) => allowedRoles.includes(r))) {
      return { name: 'account' }
    }
  } else if (to.meta.requiresPlatformStaff) {
    // Staff routes that don't opt in via `allowedRoles` are admin-only.
    const roles = auth.user?.platformRoles ?? []
    if (!roles.includes('admin')) {
      return { name: 'account' }
    }
  }
  if (to.meta.guestOnly && auth.isAuthenticated) {
    return { name: 'account' }
  }
  return true
})
