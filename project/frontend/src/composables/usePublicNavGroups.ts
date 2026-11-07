import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { SidebarNavGroup } from '@/components/AppSidebar.vue'

/**
 * The sidebar's content for a visitor who isn't signed in (or is signed in
 * but on a page outside the business panel) — mirrors useUserNavGroups'
 * shape so AppSidebar never has to special-case it. Exists because the
 * sliding mobile drawer used to only ever mount for an authenticated owner
 * on a "panel" route; everyone else (logged out, or logged in on e.g.
 * /support or /account) had no drawer at all on a phone, just whatever fit
 * in the navbar's own cramped row.
 */
export function usePublicNavGroups() {
  const { t } = useI18n()

  const groups = computed<SidebarNavGroup[]>(() => [
    {
      items: [
        { to: { name: 'feed' }, label: t('nav.discover'), icon: 'mdi-compass-outline' },
        { to: { name: 'create' }, label: t('nav.createBusiness'), icon: 'mdi-creation' },
      ],
    },
  ])

  return { groups }
}
