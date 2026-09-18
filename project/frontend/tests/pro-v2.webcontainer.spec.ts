import { describe, expect, it, vi } from 'vitest'

vi.mock('@webcontainer/api', () => ({
  WebContainer: { boot: vi.fn() },
  PreviewMessageType: {
    UncaughtException: 'PREVIEW_UNCAUGHT_EXCEPTION',
    UnhandledRejection: 'PREVIEW_UNHANDLED_REJECTION',
    ConsoleError: 'PREVIEW_CONSOLE_ERROR',
  },
}))

type Listener = (...args: unknown[]) => void

/** `lib/webcontainer.ts` deliberately caches ONE WebContainer instance at
 *  module scope ("booting a second one throws" in a real tab) — correct in
 *  production, but it means the module must be freshly re-imported for each
 *  test here, or the second test would silently reuse the first test's fake
 *  container instead of the one set up in its own `beforeEach`. */
async function freshSandboxModule() {
  vi.resetModules()
  const api = await import('@webcontainer/api')
  const mod = await import('@/lib/webcontainer')
  return { WebContainer: api.WebContainer, ProV2Sandbox: mod.ProV2Sandbox }
}

function fakeProcess(opts: { chunks?: string[]; exitCode?: number } = {}) {
  const chunks = opts.chunks ?? []
  const output = new ReadableStream<string>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
  return { output, exit: Promise.resolve(opts.exitCode ?? 0), kill: vi.fn() }
}

function fakeContainer() {
  const listeners: Record<string, Listener[]> = {}
  const spawn = vi.fn()
  return {
    on: vi.fn((event: string, cb: Listener) => {
      ;(listeners[event] ??= []).push(cb)
      return () => {}
    }),
    mount: vi.fn(async () => {}),
    spawn,
    trigger(event: string, ...args: unknown[]) {
      for (const cb of listeners[event] ?? []) cb(...args)
    },
  }
}

describe('ProV2Sandbox — §5 execution-error capture', () => {
  let container: ReturnType<typeof fakeContainer>

  async function setup() {
    const { WebContainer, ProV2Sandbox } = await freshSandboxModule()
    container = fakeContainer()
    vi.mocked(WebContainer.boot).mockResolvedValue(container as never)
    return { ProV2Sandbox, WebContainer }
  }

  it('detects an npm install failure and reports it with kind "install"', async () => {
    const { ProV2Sandbox } = await setup()
    container.spawn.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'npm' && args[0] === 'install') {
        return fakeProcess({ chunks: ['npm ERR! missing script or bad dep\n'], exitCode: 1 })
      }
      return fakeProcess({ exitCode: 0 })
    })

    const box = new ProV2Sandbox()
    const errors: { kind: string; summary: string }[] = []
    box.onExecutionError = (e) => errors.push(e)
    box.onStatus = () => {}

    await box.start([{ path: 'package.json', content: '{}' }])

    expect(errors).toHaveLength(1)
    expect(errors[0].kind).toBe('install')
    expect(errors[0].summary).toContain('missing script')
  })

  it('detects a runtime error reported via preview-message (uncaught exception)', async () => {
    const { ProV2Sandbox, WebContainer } = await setup()
    container.spawn.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'install') return fakeProcess({ exitCode: 0 })
      return fakeProcess({ exitCode: 0 }) // dev server "runs" indefinitely enough for the test
    })

    const box = new ProV2Sandbox()
    const errors: { kind: string; summary: string }[] = []
    box.onExecutionError = (e) => errors.push(e)

    await box.start([{ path: 'package.json', content: '{}' }])
    container.trigger('preview-message', {
      type: 'PREVIEW_UNCAUGHT_EXCEPTION',
      message: 'doSomething is not defined',
      stack: 'at src/components/Hero.vue:9:2',
      previewId: 'p1',
      port: 5173,
      pathname: '/',
      search: '',
      hash: '',
    })

    expect(errors).toHaveLength(1)
    expect(errors[0].kind).toBe('runtime')
    expect(errors[0].summary).toContain('doSomething is not defined')
    // The official, documented switch for preview-message — it defaults to
    // false, which was the actual root cause of it never firing live.
    expect(WebContainer.boot).toHaveBeenCalledWith(expect.objectContaining({ forwardPreviewErrors: true }))
  })

  it('deduplicates rapid repeats of the identical error instead of reporting each one', async () => {
    const { ProV2Sandbox } = await setup()
    container.spawn.mockImplementation(async () => fakeProcess({ exitCode: 0 }))

    const box = new ProV2Sandbox()
    const errors: { kind: string; summary: string }[] = []
    box.onExecutionError = (e) => errors.push(e)
    await box.start([{ path: 'package.json', content: '{}' }])

    const msg = {
      type: 'PREVIEW_CONSOLE_ERROR',
      args: ['same error every render'],
      stack: 's',
      previewId: 'p1',
      port: 5173,
      pathname: '/',
      search: '',
      hash: '',
    }
    container.trigger('preview-message', msg)
    container.trigger('preview-message', msg)
    container.trigger('preview-message', msg)

    expect(errors).toHaveLength(1)
  })

  it('does NOT report a WebContainer/HMR WebSocket handshake failure to the agent — it is StackBlitz infrastructure noise, not a bug in the generated site', async () => {
    const { ProV2Sandbox } = await setup()
    container.spawn.mockImplementation(async () => fakeProcess({ exitCode: 0 }))

    const box = new ProV2Sandbox()
    const errors: { kind: string; summary: string }[] = []
    box.onExecutionError = (e) => errors.push(e)
    await box.start([{ path: 'package.json', content: '{}' }])

    container.trigger('preview-message', {
      type: 'PREVIEW_CONSOLE_ERROR',
      args: [
        "WebSocket connection to 'wss://k03e2io1v3fx--5173--d5306e6f.local-corp.webcontainer-api.io/' failed: " +
          "Error during WebSocket handshake: Cannot destructure property 'tcp' of 'this.tcpServers[...]' as it is undefined.",
      ],
      stack: '',
      previewId: 'p1',
      port: 5173,
      pathname: '/',
      search: '',
      hash: '',
    })

    expect(errors).toHaveLength(0)
  })

  it('detects a Vite/dev-server build error in its own output and reports kind "build"', async () => {
    const { ProV2Sandbox } = await setup()
    container.spawn.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'install') return fakeProcess({ exitCode: 0 })
      return fakeProcess({
        chunks: ['VITE ready\n', 'src/components/Hero.vue: Failed to resolve import "./Missing.vue"\n'],
        exitCode: 0,
      })
    })

    const box = new ProV2Sandbox()
    const errors: { kind: string; summary: string; path?: string }[] = []
    box.onExecutionError = (e) => errors.push(e)

    await box.start([{ path: 'package.json', content: '{}' }])
    // The dev process's output stream is piped asynchronously — give it a tick.
    await new Promise((r) => setTimeout(r, 350))

    expect(errors.some((e) => e.kind === 'build')).toBe(true)
  })

  it('detects a build error even when the real message arrives split across many tiny chunks', async () => {
    const { ProV2Sandbox } = await setup()
    // WebContainerProcess output genuinely arrives this fragmented in
    // practice — individual ANSI codes and spinner frames as separate
    // chunks — which is exactly what let a real "Failed to resolve import"
    // slip past a check that only tested each chunk on its own.
    const fragments = [
      '\x1b[1G',
      '\x1b[0K',
      'Fail',
      'ed to ',
      'resolve imp',
      `ort "./Missing.vue" from `,
      'src/components/Hero.vue',
      '\n',
    ]
    container.spawn.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'install') return fakeProcess({ exitCode: 0 })
      return fakeProcess({ chunks: fragments, exitCode: 0 })
    })

    const box = new ProV2Sandbox()
    const errors: { kind: string; summary: string; path?: string }[] = []
    box.onExecutionError = (e) => errors.push(e)

    await box.start([{ path: 'package.json', content: '{}' }])
    await new Promise((r) => setTimeout(r, 350))

    expect(errors).toHaveLength(1)
    expect(errors[0].kind).toBe('build')
    expect(errors[0].summary).toContain('Failed to resolve import')
    expect(errors[0].summary).not.toContain('\x1b') // ANSI codes stripped
  })
})
