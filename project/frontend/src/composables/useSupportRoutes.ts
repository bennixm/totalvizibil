import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import type { SupportPerspective } from '@/stores/support'

/**
 * The support pages are mounted twice in the router, once per panel:
 *
 *  - `/support…` in the NORMAL panel: always the customer experience (own
 *    tickets, "New ticket", no staff tools), for every account, a support
 *    agent filing their own ticket included.
 *  - `/admin/support…` in the ADMIN panel: the staff queue, for `admin` and
 *    `support` only (enforced by the route's `allowedRoles` AND by the API).
 *
 * The panel a page renders in is decided by its path (`App.vue`'s
 * `isAdminRoute`), so the perspective follows the path too. Links between
 * the support pages must stay in the copy they were opened from, or a click
 * would silently flip the panel; this picks the matching route names.
 */
export function useSupportRoutes() {
  const route = useRoute()
  const auth = useAuthStore()
  const inAdmin = computed(() => route.path.startsWith('/admin'))
  const perspective = computed<SupportPerspective>(() =>
    inAdmin.value && auth.isSupportStaff ? 'staff' : 'requester',
  )
  return {
    inAdmin,
    perspective,
    listRoute: computed(() => ({ name: inAdmin.value ? 'admin-support' : 'support' })),
    ticketRoute: (id: string) => ({
      name: inAdmin.value ? 'admin-support-ticket' : 'support-ticket',
      params: { id },
    }),
  }
}
