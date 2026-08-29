import { vi } from 'vitest'

// Vuetify's layout composables call these browser APIs that jsdom doesn't implement.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as never)

if (!globalThis.matchMedia) {
  globalThis.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

// CSS.supports is used by Vuetify's color utilities.
globalThis.CSS = globalThis.CSS ?? ({ supports: () => false } as never)

// jsdom lacks visualViewport; Vuetify overlays read it defensively but the type check helps.
globalThis.visualViewport = globalThis.visualViewport ?? (null as never)
