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
  }),
  actions: {
    toggleSidebar(): void {
      this.sidebarOpen = !this.sidebarOpen
    },
    closeSidebar(): void {
      this.sidebarOpen = false
    },
  },
})
