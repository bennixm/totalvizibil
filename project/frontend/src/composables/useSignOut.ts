import { useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { useCompaniesStore } from '@/stores/companies'
import { useGoogleAdsUserStore } from '@/stores/googleAdsUser'
import { useMoneyStore } from '@/stores/money'
import { useNotificationsStore } from '@/stores/notifications'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * Signs out and clears every per-session store — the one place this sequence
 * is defined, used by both the account dropdown and the sidebar footer.
 */
export function useSignOut() {
  const router = useRouter()
  const auth = useAuthStore()
  const companies = useCompaniesStore()
  const money = useMoneyStore()
  const notifications = useNotificationsStore()
  const ads = useGoogleAdsUserStore()
  const workspace = useWorkspaceStore()

  function signOut(): void {
    auth.logout()
    companies.reset()
    money.reset()
    notifications.reset()
    ads.reset()
    workspace.reset()
    void router.push({ name: 'feed' })
  }

  return { signOut }
}
