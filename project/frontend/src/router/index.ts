import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { useDraftStore } from '@/stores/draft'

const routes: RouteRecordRaw[] = [
  // --- Discovery (public, the main experience) ---
  {
    path: '/',
    name: 'feed',
    component: () => import('@/views/FeedView.vue'),
  },
  {
    path: '/c/:slug',
    name: 'company',
    component: () => import('@/views/CompanyPublicView.vue'),
  },

  // --- Create your business (AI-first, register at the end) ---
  {
    path: '/create',
    name: 'create',
    component: () => import('@/views/CreateBusinessView.vue'),
  },
  {
    path: '/create/easy',
    name: 'create-easy',
    component: () => import('@/views/CreateEasyView.vue'),
  },
  {
    path: '/create/advanced',
    name: 'create-advanced',
    component: () => import('@/views/CreateAdvancedView.vue'),
  },
  {
    path: '/create/preview',
    name: 'create-preview',
    component: () => import('@/views/WebsitePreviewView.vue'),
    meta: { requiresDraft: true },
  },
  {
    path: '/create/account',
    name: 'create-account',
    component: () => import('@/views/ClaimAccountView.vue'),
    meta: { requiresDraft: true },
  },

  // --- Owner area ---
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { guestOnly: true },
  },
  {
    path: '/admin',
    name: 'admin',
    component: () => import('@/views/AdminView.vue'),
    meta: { requiresAuth: true, requiresPlatformStaff: true },
  },

  // --- Redirects from the old IA ---
  { path: '/register', redirect: { name: 'create' } },
  { path: '/for-business', redirect: { name: 'create' } },
  { path: '/search', redirect: { name: 'feed' } },
  { path: '/companies/new', redirect: { name: 'create' } },

  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
  },
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
    return { name: 'dashboard' }
  }
  if (to.meta.guestOnly && auth.isAuthenticated) {
    return { name: 'dashboard' }
  }
  if (to.meta.requiresDraft && !useDraftStore().hasDraft) {
    return { name: 'create' }
  }
  return true
})
