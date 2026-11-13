import { defineStore } from 'pinia'

/**
 * Shell-level UI state that doesn't belong to any one feature — currently
 * just whether the panel sidebar (user dashboard / admin) is open. On desktop
 * it's docked open; on mobile it's a temporary drawer toggled from AppBar's
 * hamburger button.
 */
export const useUiStore = defineStore('ui', {
  state: () => ({
    sidebarOpen: false,
    /** True exactly while `FeedView` is mounted — reached either directly
     *  (`/`) or nested inside `BrowseView` for a category (never for a
     *  company page, which mounts `CompanyPublicView` instead). The single
     *  signal the exit-confirmation popup (router.ts's `beforeEach`, and the
     *  `beforeunload` listener in App.vue) needs to tell "still browsing the
     *  feed" apart from "looking at a company page" or "elsewhere in the
     *  app" — see docs/ai/GOOGLE-ADS-AGENT-PLAN-RESEARCH.md, Direction 7. */
    viewingFeed: false,
  }),
  actions: {
    toggleSidebar(): void {
      this.sidebarOpen = !this.sidebarOpen
    },
    closeSidebar(): void {
      this.sidebarOpen = false
    },
    setViewingFeed(v: boolean): void {
      this.viewingFeed = v
    },
  },
})
