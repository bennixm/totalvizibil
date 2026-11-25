import { useRouter } from 'vue-router'

import { clearSessionData } from '@/lib/session'
import { useAuthStore } from '@/stores/auth'

/**
 * Signs out and forgets the user's data. The one place this sequence is
 * defined, used by both the account dropdown and the sidebar footer.
 */
export function useSignOut() {
  const router = useRouter()
  const auth = useAuthStore()

  function signOut(): void {
    auth.logout()
    clearSessionData()
    void router.push({ name: 'feed' })
  }

  return { signOut }
}
