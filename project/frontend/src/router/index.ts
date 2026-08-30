import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

import { useAuthStore } from '@/stores/auth'

const routes: RouteRecordRaw[] = [
  // --- Discovery (public) ---
  { path: '/', name: 'feed', component: () => import('@/views/FeedView.vue') },
  { path: '/c/:slug', name: 'company', component: () => import('@/views/CompanyPublicView.vue') },

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

  // --- Business dashboard ---
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/wallet',
    name: 'wallet',
    component: () => import('@/views/WalletView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/campaign',
    name: 'campaign',
    component: () => import('@/views/CampaignView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/leads',
    name: 'leads',
    component: () => import('@/views/LeadsView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/website/builder',
    name: 'website-builder',
    component: () => import('@/views/AdvancedBuilderView.vue'),
    meta: { requiresAuth: true },
  },

  // --- Account & auth ---
  {
    path: '/account',
    name: 'account',
    component: () => import('@/views/AccountView.vue'),
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
    ],
  },

  // --- Redirects from the old IA ---
  { path: '/register', redirect: { name: 'create' } },
  { path: '/for-business', redirect: { name: 'create' } },
  { path: '/search', redirect: { name: 'feed' } },
  { path: '/companies/new', redirect: { name: 'create' } },
  { path: '/create/:rest(.*)', redirect: { name: 'create' } },

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
  const auth = useAuthStore()
  if (!auth.ready) await auth.bootstrap()

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
