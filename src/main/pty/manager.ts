import { randomUUID } from 'node:crypto'
import * as nodePty from 'node-pty'

/**
 * Lifecycle seam over `node-pty` so tests can inject a fake spawn
 * without pulling in the native module. The production wiring uses
 * `node-pty.spawn`; tests inject a tiny stub that mirrors the parts
 * of the IPty surface we touch.
 */
export interface PtyLike {
  onData(cb: (data: string) => void): { dispose(): void }
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void }
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

export type PtySpawn = (
  command: string,
  args: string[],
  options: { cwd: string; cols: number; rows: number; env: NodeJS.ProcessEnv }
) => PtyLike

const defaultSpawn: PtySpawn = (command, args, options) =>
  nodePty.spawn(command, args, {
    name: 'xterm-color',
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: options.env
  }) as unknown as PtyLike

export interface CreatePtyInput {
  /** Identifier used for streaming-event payload routing on the renderer. */
  ptyId?: string
  command: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  /** Streamed to renderer on every output chunk. */
  onData: (ptyId: string, data: string) => void
  /** Fired once when the pty's child exits. */
  onExit: (ptyId: string, exitCode: number) => void
}

interface Entry {
  pty: PtyLike
  dataSub: { dispose(): void }
  exitSub: { dispose(): void }
}

/**
 * Owns the live `node-pty` processes for the renderer's xterm
 * components. Each pty is keyed by a stable `ptyId` so the data /
 * exit events the manager fires can be routed to exactly one
 * renderer subscriber. Slice 16 ships single-pty semantics; the map
 * is already keyed so Slice 17 just adds tabs around the same
 * surface without changing this layer.
 */
export class PtyManager {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly spawn: PtySpawn = defaultSpawn) {}

  create(input: CreatePtyInput): string {
    const ptyId = input.ptyId ?? randomUUID()
    const pty = this.spawn(input.command, input.args, {
      cwd: input.cwd,
      cols: input.cols,
      rows: input.rows,
      env: process.env
    })
    const dataSub = pty.onData((data) => input.onData(ptyId, data))
    const exitSub = pty.onExit(({ exitCode }) => {
      input.onExit(ptyId, exitCode)
      // Auto-remove from the registry so the renderer can never
      // accidentally write to an already-exited pty.
      this.entries.delete(ptyId)
      dataSub.dispose()
      exitSub.dispose()
    })
    this.entries.set(ptyId, { pty, dataSub, exitSub })
    return ptyId
  }

  write(ptyId: string, data: string): boolean {
    const entry = this.entries.get(ptyId)
    if (!entry) return false
    entry.pty.write(data)
    return true
  }

  resize(ptyId: string, cols: number, rows: number): boolean {
    const entry = this.entries.get(ptyId)
    if (!entry) return false
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) {
      return false
    }
    entry.pty.resize(Math.floor(cols), Math.floor(rows))
    return true
  }

  kill(ptyId: string, signal: string = 'SIGTERM'): boolean {
    const entry = this.entries.get(ptyId)
    if (!entry) return false
    entry.pty.kill(signal)
    return true
  }

  list(): string[] {
    return Array.from(this.entries.keys())
  }

  closeAll(signal: string = 'SIGTERM'): void {
    for (const [, entry] of this.entries) {
      try {
        entry.pty.kill(signal)
      } catch {
        // best-effort
      }
      entry.dataSub.dispose()
      entry.exitSub.dispose()
    }
    this.entries.clear()
  }
}
