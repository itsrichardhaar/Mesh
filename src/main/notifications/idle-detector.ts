import type Database from 'better-sqlite3'
import type { Notification, NotificationKind } from '@shared/types'
import { insertNotification, markAllRead } from './repository'

/**
 * Idle threshold (ms): how long a live Pty Tab must go without PTY
 * output before a notification fires. 8 s is the value resolved during
 * v5 planning — short enough to catch real "agent stopped, may need
 * you" moments; long enough to ignore Claude's typical 3–5 s mid-
 * thought pauses.
 */
export const IDLE_THRESHOLD_MS = 8_000

export const DEFAULT_IDLE_LABEL: Record<NotificationKind, string> = {
  idle: 'Agent is idle'
}

export interface IdleDetectorDeps {
  db: Database.Database
  now: () => number
  scheduleTimeout: (cb: () => void, ms: number) => unknown
  cancelTimeout: (timer: unknown) => void
  /**
   * Bridge to the renderer event channels. The main-process wiring
   * binds this to `mainWindow.webContents.send(channel, payload)`;
   * tests inject a stub.
   */
  emit: (channel: 'notifications:created' | 'notifications:updated' | 'notifications:cleared', payload: unknown) => void
  /**
   * UUID factory. Defaults to `crypto.randomUUID` in production; tests
   * inject deterministic ids.
   */
  generateId: () => string
  /**
   * ISO 8601 timestamp factory derived from `now()` if not provided.
   * Exposed for tests that want a precise wall-clock string.
   */
  nowIso?: () => string
}

interface PtyEntry {
  ptyId: string
  encodedPath: string
  sessionId: string
  /** Pending fire timer; cleared whenever activity arrives or the PTY exits. */
  timer: unknown | null
  /**
   * Has the current idle period already fired its notification? Reset
   * to false on every new chunk of activity (re-arm) and on PTY exit.
   */
  alreadyFired: boolean
}

/**
 * Main-process module that watches each live Pty Tab's activity stream
 * and inserts a `notifications` row when the tab transitions from
 * active to idle (no PTY output for ≥ 8 s) AND is not currently
 * foregrounded. Pure logic with injected clock / scheduler / emitter
 * so the timing behavior, debounce, and suppression rules are unit-
 * testable independent of Electron.
 *
 * Auto-mark-read triggers handled here:
 *  - PTY un-idles (output resumes after a notification fired) → mark
 *    all that Session's unread rows read.
 *  - PTY exits (process ended) → mark all that Session's unread rows
 *    read.
 *  - User navigates to the Session's Pty Tab → handled by the renderer
 *    via `notifications.markAllRead({ sessionId })` (Slice 42).
 */
export class IdleDetector {
  private readonly entries = new Map<string, PtyEntry>()
  private foregroundPtyId: string | null = null
  private muteCheck: () => { global: boolean; project: (encodedPath: string) => boolean } = () => ({
    global: false,
    project: () => false
  })

  constructor(private readonly deps: IdleDetectorDeps) {}

  /**
   * Slice 43 (v5) hook: mute-controls suppress *toast emission*, not
   * storage. Bound by `main/index.ts` so the detector reads live mute
   * state at fire time. Default no-op keeps Slice 41 tests trivial.
   */
  configureMuteCheck(check: () => { global: boolean; project: (encodedPath: string) => boolean }): void {
    this.muteCheck = check
  }

  /** Tell the detector which Pty Tab the user is currently looking at. */
  setForegroundPty(ptyId: string | null): void {
    this.foregroundPtyId = ptyId
  }

  /** Register a PTY's metadata so future activity events can be attributed. */
  registerPty(ptyId: string, encodedPath: string, sessionId: string): void {
    this.entries.set(ptyId, {
      ptyId,
      encodedPath,
      sessionId,
      timer: null,
      alreadyFired: false
    })
  }

  /**
   * Call on every PTY data chunk. Cancels the pending idle timer (if any),
   * re-arms a fresh one, and — if a notification had already fired for
   * the previous idle period — marks all that Session's unread rows
   * read since the agent is producing output again.
   */
  onPtyData(ptyId: string): void {
    const entry = this.entries.get(ptyId)
    if (!entry) return
    if (entry.timer !== null) {
      this.deps.cancelTimeout(entry.timer)
      entry.timer = null
    }
    if (entry.alreadyFired) {
      this.autoMarkRead(entry.sessionId)
      entry.alreadyFired = false
    }
    entry.timer = this.deps.scheduleTimeout(() => {
      this.fire(entry)
    }, IDLE_THRESHOLD_MS)
  }

  /**
   * Call when a PTY exits. Cancels the pending timer, marks all that
   * Session's unread rows read (no action possible now), and clears
   * the entry.
   */
  onPtyExit(ptyId: string): void {
    const entry = this.entries.get(ptyId)
    if (!entry) return
    if (entry.timer !== null) {
      this.deps.cancelTimeout(entry.timer)
      entry.timer = null
    }
    this.autoMarkRead(entry.sessionId)
    this.entries.delete(ptyId)
  }

  /**
   * Best-effort teardown of all pending timers (e.g. on app shutdown).
   * Does not fire pending notifications.
   */
  shutdown(): void {
    for (const entry of this.entries.values()) {
      if (entry.timer !== null) this.deps.cancelTimeout(entry.timer)
    }
    this.entries.clear()
  }

  private fire(entry: PtyEntry): void {
    entry.timer = null
    // Foreground suppression — the user is already looking at this Pty
    // Tab; no need to interrupt their gaze with a toast they don't
    // need. Both the toast AND the SQLite row are suppressed in this
    // case (different from mute, where the row is still stored).
    if (this.foregroundPtyId === entry.ptyId) return
    // Debounce — should never re-enter here within the same idle
    // period because the timer is cancelled on every data chunk and
    // on exit, but guard explicitly.
    if (entry.alreadyFired) return
    entry.alreadyFired = true

    const id = this.deps.generateId()
    const createdAt = this.deps.nowIso ? this.deps.nowIso() : new Date(this.deps.now()).toISOString()
    const kind: NotificationKind = 'idle'
    const row: Notification = insertNotification(this.deps.db, {
      id,
      createdAt,
      encodedPath: entry.encodedPath,
      sessionId: entry.sessionId,
      ptyId: entry.ptyId,
      kind,
      labelText: DEFAULT_IDLE_LABEL[kind] ?? 'Agent is idle'
    })

    // Slice 43 (v5): mute gates *toast emission*, not storage. The row
    // is already persisted; only the `notifications:created` event is
    // suppressed when muted (renderer subscribes to this event for
    // toast popups).
    const mute = this.muteCheck()
    if (mute.global || mute.project(entry.encodedPath)) return

    this.deps.emit('notifications:created', row)
  }

  private autoMarkRead(sessionId: string): void {
    const at = this.deps.nowIso ? this.deps.nowIso() : new Date(this.deps.now()).toISOString()
    const { updated } = markAllRead(this.deps.db, { sessionId }, at)
    if (updated.length > 0) {
      this.deps.emit('notifications:updated', { ids: updated })
    }
  }
}
