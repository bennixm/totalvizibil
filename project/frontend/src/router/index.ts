import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { useMoneyStore } from '@/stores/money'

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
    path: '/leads',
    name: 'leads',
    component: () => import('@/views/LeadsView.vue'),
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
    children: [
      { path: '', redirect: { name: 'admin-dashboard' } },
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
        path: 'settings',
        name: 'admin-settings',
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
        component: () => import('@/views/admin/AdminInvoicesView.vue'),
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

router.beforeEach(async (to) => {
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
  if (to.meta.requiresPlatformStaff && !auth.isPlatformStaff) {
    return { name: 'account' }
  }
  if (to.meta.guestOnly && auth.isAuthenticated) {
    return { name: 'account' }
  }
  return true
})
