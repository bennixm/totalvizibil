import { defineStore } from 'pinia'
import type { RouteLocationRaw } from 'vue-router'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'

export interface ToastAction {
  label: string
  to: RouteLocationRaw
}

export interface Toast {
  id: number
  kind: ToastKind
  text: string
  action?: ToastAction
}

interface PushOpts {
  /** ms before auto-dismiss; 0 = stays until the X is pressed. */
  timeout?: number
  action?: ToastAction
}

let seq = 0
const MAX = 4
const DEFAULT_MS: Record<ToastKind, number> = {
  success: 3500,
  info: 4000,
  warning: 6000,
  error: 7000,
}

/**
 * One place every user-facing alert goes through, so they all look and behave
 * the same: a dismissible pop-up with an X. Views call `toast.error(msg)` /
 * `toast.success(msg)` etc. instead of rendering their own inline banners.
 */
export const useToastStore = defineStore('toast', {
  state: () => ({ items: [] as Toast[] }),
  actions: {
    push(kind: ToastKind, text: string, opts: PushOpts = {}): number {
      const msg = (text ?? '').toString().trim()
      if (!msg) return 0
      const id = ++seq
      this.items.push({ id, kind, text: msg, action: opts.action })
      if (this.items.length > MAX) this.items.splice(0, this.items.length - MAX)
      const ms = opts.timeout ?? DEFAULT_MS[kind]
      if (ms > 0 && typeof window !== 'undefined') {
        window.setTimeout(() => this.dismiss(id), ms)
      }
      return id
    },
    success(text: string, opts?: PushOpts): number {
      return this.push('success', text, opts)
    },
    error(text: string, opts?: PushOpts): number {
      return this.push('error', text, opts)
    },
    info(text: string, opts?: PushOpts): number {
      return this.push('info', text, opts)
    },
    warning(text: string, opts?: PushOpts): number {
      return this.push('warning', text, opts)
    },
    dismiss(id: number): void {
      this.items = this.items.filter((t) => t.id !== id)
    },
    clear(): void {
      this.items = []
    },
  },
})
