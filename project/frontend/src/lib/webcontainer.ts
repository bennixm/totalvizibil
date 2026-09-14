import {
  WebContainer,
  PreviewMessageType,
  type FileSystemTree,
  type WebContainerProcess,
  type PreviewMessage,
} from '@webcontainer/api'
import { normalizeErrorKey, extractFilePath } from './repair-loop'

export interface ProjectFile {
  path: string
  content: string
}

/** Converts a flat {path, content}[] list into WebContainer's nested tree shape. */
export function filesToTree(files: ProjectFile[]): FileSystemTree {
  const tree: FileSystemTree = {}
  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean)
    let node = tree
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts[i]
      const existing = node[dir]
      if (!existing || !('directory' in existing)) {
        node[dir] = { directory: {} }
      }
      node = (node[dir] as { directory: FileSystemTree }).directory
    }
    node[parts[parts.length - 1]] = { file: { contents: f.content } }
  }
  return tree
}

/** One WebContainer instance per browser tab — booting a second one throws.
 *  `forwardPreviewErrors: true` is the official, documented switch for the
 *  `preview-message` event (console.error / unhandledrejection / uncaught
 *  error in any preview iframe) — it defaults to `false`. No custom script
 *  injection is needed or supported for this; see `BootOptions` in
 *  `@webcontainer/api`. */
let containerPromise: Promise<WebContainer> | null = null
function bootContainer(): Promise<WebContainer> {
  if (!containerPromise) containerPromise = WebContainer.boot({ forwardPreviewErrors: true })
  return containerPromise
}

/** One built `dist/` output file, ready to upload to the publish endpoint. */
export interface BundleFile {
  path: string
  contentBase64: string
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export type LogLine = { text: string; kind: 'info' | 'error' }
export type SandboxStatus = 'booting' | 'installing' | 'starting' | 'ready' | 'error' | 'fixing' | 'failed'
export type ExecutionError = {
  kind: 'install' | 'build' | 'runtime'
  summary: string
  path?: string
}

/** Lines that plausibly indicate a real build/dev-server error, as opposed to
 *  Vite's normal chatter (connecting, optimizing deps, page reload notices). */
const BUILD_ERROR_RE =
  /\berror\b|failed to resolve|cannot find module|unexpected token|is not defined|syntaxerror|internal server error/i
/** WebContainerProcess output arrives in small, sometimes single-character
 *  chunks (spinner frames, individual ANSI escape codes) — a real multi-word
 *  message like "Failed to resolve import" can easily land split across
 *  several chunks. Matching against each chunk alone (the original bug here)
 *  can silently miss a real error; matching against a rolling, ANSI-stripped
 *  buffer of the recent output is what actually sees the whole message. */
const OUTPUT_BUFFER_CHARS = 4000
/** A real error message keeps streaming in over several chunks in quick
 *  succession — reporting the instant the regex first matches can catch it
 *  mid-message (e.g. "Failed to resolve imp[...]", missing the actual import
 *  path). Debouncing until output has been quiet this long reports the whole
 *  thing instead of a truncated fragment. */
const ERROR_DEBOUNCE_MS = 250

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
}

/** Owns the one WebContainer instance for a PRO V2 session: boot, mount,
 *  install, run the dev server, push updated files in on later turns, and
 *  surface install/build/runtime failures via `onExecutionError` so the
 *  caller can drive a repair turn. */
export class ProV2Sandbox {
  private container: WebContainer | null = null
  private devProcess: WebContainerProcess | null = null
  private lastPackageJson = ''
  private killingDevIntentionally = false
  private outputBuffer = ''
  private pendingBuildError: ReturnType<typeof setTimeout> | null = null
  private lastErrorKey: string | null = null
  private lastErrorAt = 0

  onLog: (line: LogLine) => void = () => {}
  onServerReady: (url: string) => void = () => {}
  onStatus: (status: SandboxStatus) => void = () => {}
  onExecutionError: (err: ExecutionError) => void = () => {}

  async start(files: ProjectFile[]): Promise<void> {
    this.onStatus('booting')
    this.container = await bootContainer()
    this.container.on('server-ready', (_port, url) => {
      this.onStatus('ready')
      this.onServerReady(url)
    })
    this.container.on('error', (e) => {
      this.onStatus('error')
      this.reportExecutionError('build', `Container error: ${e.message}`)
    })
    // Registered before mount/install/dev — i.e. before any preview exists —
    // so no message can be missed once the dev server actually starts.
    this.container.on('preview-message', (message) => this.onPreviewMessage(message))
    await this.container.mount(filesToTree(files))
    this.lastPackageJson = files.find((f) => f.path === 'package.json')?.content ?? ''
    this.onStatus('installing')
    const installOk = await this.runInstall()
    if (!installOk) return
    this.onStatus('starting')
    await this.runDev()
  }

  /** Push an updated file set in after an agent turn (a normal edit or a
   *  repair). Remounting the whole (small) tree is simpler and safer than
   *  patching individual files — it creates any new directories for free —
   *  and Vite picks the changes up live. Only re-installs/restarts if
   *  package.json's content changed. */
  async sync(files: ProjectFile[]): Promise<void> {
    if (!this.container) return
    await this.container.mount(filesToTree(files))
    const pkg = files.find((f) => f.path === 'package.json')?.content ?? ''
    if (pkg !== this.lastPackageJson) {
      this.lastPackageJson = pkg
      this.killingDevIntentionally = true
      this.devProcess?.kill()
      this.onStatus('installing')
      const installOk = await this.runInstall()
      if (!installOk) return
      this.onStatus('starting')
      await this.runDev()
    }
  }

  /** Dedup + fan-out for any of the three error sources — collapses rapid
   *  duplicate signals of the SAME incident (e.g. a console.error firing on
   *  every re-render) within a short window, without swallowing a genuine
   *  later recurrence the caller's own retry-bound logic needs to see. */
  private reportExecutionError(kind: ExecutionError['kind'], rawText: string): void {
    const summary = rawText.trim().slice(0, 2000)
    if (!summary) return
    const key = normalizeErrorKey(summary)
    const now = Date.now()
    if (key === this.lastErrorKey && now - this.lastErrorAt < 2000) return
    this.lastErrorKey = key
    this.lastErrorAt = now
    this.onLog({ text: summary, kind: 'error' })
    this.onExecutionError({ kind, summary, path: extractFilePath(summary) })
  }

  private onPreviewMessage(message: PreviewMessage): void {
    switch (message.type) {
      case PreviewMessageType.UncaughtException:
        this.reportExecutionError('runtime', `Uncaught exception: ${message.message}\n${message.stack ?? ''}`)
        break
      case PreviewMessageType.UnhandledRejection:
        this.reportExecutionError('runtime', `Unhandled rejection: ${message.message}\n${message.stack ?? ''}`)
        break
      case PreviewMessageType.ConsoleError:
        this.reportExecutionError(
          'runtime',
          `Console error: ${message.args.map((a) => String(a)).join(' ')}\n${message.stack ?? ''}`,
        )
        break
    }
  }

  private async pipeToLog(process: WebContainerProcess, watchForErrors: boolean): Promise<void> {
    const writable = new WritableStream<string>({
      write: (chunk) => {
        this.onLog({ text: chunk, kind: 'info' })
        this.outputBuffer = (this.outputBuffer + stripAnsi(chunk)).slice(-OUTPUT_BUFFER_CHARS)
        if (watchForErrors && BUILD_ERROR_RE.test(this.outputBuffer)) {
          // Each further chunk while the match holds pushes this back, so we
          // only report once the burst has actually finished arriving.
          if (this.pendingBuildError) clearTimeout(this.pendingBuildError)
          this.pendingBuildError = setTimeout(() => {
            this.pendingBuildError = null
            this.reportExecutionError('build', this.outputBuffer)
            // Reset so the same already-reported text can't keep re-matching
            // on every later, unrelated chunk until it scrolls out on its own.
            this.outputBuffer = ''
          }, ERROR_DEBOUNCE_MS)
        }
      },
    })
    await process.output.pipeTo(writable)
  }

  private async runInstall(): Promise<boolean> {
    if (!this.container) return false
    this.onLog({ text: '$ npm install', kind: 'info' })
    this.outputBuffer = ''
    const install = await this.container.spawn('npm', ['install'])
    const pipe = this.pipeToLog(install, false)
    const code = await install.exit
    await pipe
    if (code !== 0) {
      this.onStatus('error')
      this.reportExecutionError('install', this.outputBuffer || `npm install exited with code ${code}`)
      return false
    }
    return true
  }

  /** Builds the project for publishing (`npm run build`, the same Vite
   *  config used for `npm run dev`) and reads the resulting `dist/` output
   *  back out of the WebContainer filesystem. Reuses the SAME already-booted
   *  container/mounted files — no second sandbox, no server-side build. */
  async build(): Promise<{ ok: true; files: BundleFile[] } | { ok: false; error: string }> {
    if (!this.container) return { ok: false, error: 'Sandbox is not running' }
    this.onLog({ text: '$ npm run build', kind: 'info' })
    let output = ''
    const proc = await this.container.spawn('npm', ['run', 'build'])
    await proc.output.pipeTo(
      new WritableStream<string>({
        write: (chunk) => {
          this.onLog({ text: chunk, kind: 'info' })
          output = (output + stripAnsi(chunk)).slice(-OUTPUT_BUFFER_CHARS)
        },
      }),
    )
    const code = await proc.exit
    if (code !== 0) return { ok: false, error: output || `npm run build exited with code ${code}` }

    const files: BundleFile[] = []
    const walk = async (dir: string): Promise<void> => {
      const entries = await this.container!.fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = `${dir}/${entry.name}`
        if (entry.isDirectory()) {
          await walk(full)
        } else {
          const bytes = await this.container!.fs.readFile(full)
          files.push({ path: full.slice('dist/'.length), contentBase64: uint8ToBase64(bytes) })
        }
      }
    }
    try {
      await walk('dist')
    } catch (e) {
      return { ok: false, error: `Build succeeded but "dist/" could not be read: ${String(e)}` }
    }
    if (!files.some((f) => f.path === 'index.html')) {
      return { ok: false, error: 'Build succeeded but "dist/index.html" is missing' }
    }
    return { ok: true, files }
  }

  private async runDev(): Promise<void> {
    if (!this.container) return
    this.onLog({ text: '$ npm run dev', kind: 'info' })
    this.outputBuffer = ''
    this.killingDevIntentionally = false
    const proc = await this.container.spawn('npm', ['run', 'dev'])
    this.devProcess = proc
    void this.pipeToLog(proc, true)
    void proc.exit.then((code) => {
      if (code !== 0 && !this.killingDevIntentionally && this.devProcess === proc) {
        this.reportExecutionError('build', this.outputBuffer || `dev server exited with code ${code}`)
      }
    })
  }
}
