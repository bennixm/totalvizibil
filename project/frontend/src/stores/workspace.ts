import { defineStore } from 'pinia'

import { isWorkspaceId, WORKSPACES, type Workspace, type WorkspaceId } from '@/lib/workspaces'

const KEY = 'tvz.workspace.v1'

function stored(): WorkspaceId {
  try {
    const v = localStorage.getItem(KEY)
    if (isWorkspaceId(v)) return v
  } catch {
    /* storage unavailable */
  }
  return 'site'
}

/**
 * Which area (sites, Google Ads...) the signed-in user is in. Set by the
 * router on every page that belongs to an area; shared pages (wallet,
 * support...) leave it alone, so the sidebar never jumps to another product.
 */
export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({ id: stored() as WorkspaceId }),
  getters: {
    current: (s): Workspace => WORKSPACES.find((w) => w.id === s.id) ?? WORKSPACES[0],
  },
  actions: {
    enter(id: WorkspaceId): void {
      if (this.id === id) return
      this.id = id
      try {
        localStorage.setItem(KEY, id)
      } catch {
        /* storage unavailable: kept for this page view */
      }
    },
    /** First sign-in on this browser: a Google Ads-only owner starts in the
     *  Google Ads area, everyone else in the site area. A choice the user
     *  already made here is never overridden. */
    pickFor(businesses: number, adsCampaigns: number): void {
      try {
        if (localStorage.getItem(KEY)) return
      } catch {
        /* storage unavailable: decide anyway */
      }
      if (!businesses && adsCampaigns) this.enter('ads')
    },
    reset(): void {
      this.id = 'site'
      try {
        localStorage.removeItem(KEY)
      } catch {
        /* storage unavailable */
      }
    },
  },
})
