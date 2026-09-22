import { defineStore } from 'pinia'

export type ConfirmTone = 'error' | 'warning' | 'primary'

interface ConfirmOptions {
  /** Shorthand for tone: true → 'error' (default), false → 'primary'. */
  danger?: boolean
  tone?: ConfirmTone
  confirmLabel?: string
  cancelLabel?: string
}

interface ConfirmState {
  show: boolean
  title: string
  text: string
  tone: ConfirmTone
  confirmLabel: string
  cancelLabel: string
  run: () => void | Promise<void>
}

/**
 * One shared confirm-before-destructive-action dialog for the whole app —
 * mounted once (`ConfirmDialog.vue` in App.vue), driven from anywhere via
 * `useConfirmStore().ask(...)`. Replaces the same `confirmState` reactive
 * object that used to get hand-copied into every view that needed a
 * "are you sure?" prompt.
 */
export const useConfirmStore = defineStore('confirm', {
  state: (): ConfirmState => ({
    show: false,
    title: '',
    text: '',
    tone: 'error',
    confirmLabel: '',
    cancelLabel: '',
    run: () => {},
  }),
  actions: {
    ask(title: string, text: string, run: () => void | Promise<void>, opts: ConfirmOptions = {}): void {
      this.show = true
      this.title = title
      this.text = text
      this.tone = opts.tone ?? (opts.danger === false ? 'primary' : 'error')
      this.confirmLabel = opts.confirmLabel ?? ''
      this.cancelLabel = opts.cancelLabel ?? ''
      this.run = run
    },
    cancel(): void {
      this.show = false
    },
    async confirm(): Promise<void> {
      const fn = this.run
      this.show = false
      await fn()
    },
  },
})
