import type Database from 'better-sqlite3'
import type { Notification, NotificationKind } from '@shared/types'
import { insertNotification, markAllRead } from './repository'
import { ScreenModel } from './screen-model'
import { classify } from './matchers'

/**
 * Idle threshold (ms): how long a live Pty Tab must go without PTY
 * output before a notification fires. 8 s is the value resolved during
 * v5 planning — short enough to catch real "agent stopped, may need
 * you" moments; long enough to ignore Claude's typical 3–5 s mid-
 * thought pauses.
 */
export const IDLE_THRESHOLD_MS = 8_000

/**
 * Settle window (ms) for Pattern Matchers (v9): how long after the last
 * PTY chunk to wait before classifying the screen. Long enough for an
 * Ink repaint storm to settle into a stable frame (and for the headless
 * screen buffer to finish parsing), short enough that an `approval`
 * prompt surfaces near-instantly rather than waiting out the 8 s idle
 * floor. Well under IDLE_THRESHOLD_MS so a matcher always beats idle.
 */
export const SETTLE_MS = 250

/**
 * Generic per-kind labels. v9 detects `approval` + `complete` via
 * Pattern Matchers (see ./matchers); `idle` remains the recall floor.
 * Labels are deliberately generic — the toast/dropdown row already
 * carries Project/Session context, so no content extraction is needed
 * (PRD-v9). Lookup falls back to the `idle` label for any unknown kind.
 */
export const DEFAULT_KIND_LABEL: Record<NotificationKind, string> = {
  idle: 'Agent is idle',
  approval: 'Approval needed',
  complete: 'Task complete'
}

/**
 * The detector's synchronous view of a Pty Tab's terminal screen. The
 * production adapter (see `defaultCreateScreen`) wraps the async
 * `ScreenModel` with fire-and-forget writes; the SETTLE_MS real-time
 * delay before `snapshot()` masks the parse latency. Tests inject a
 * synchronous fake so the detector's fire-first / dedup logic is
 * exercised without xterm or real timers.
 */
export interface ScreenView {
  write(bytes: string): void
  snapshot(): string
  dispose(): void
}

const defaultCreateScreen = (): ScreenView => {
  const model = new ScreenModel()
  return {
    write: (bytes) => {
      void model.write(bytes)
    },
    snapshot: () => model.snapshot(),
    dispose: () => model.dispose()
  }
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
  /**
   * Factory for a per-Pty screen view. Defaults to a ScreenModel-backed
   * adapter; tests inject a synchronous fake. (v9 / Slice 64)
   */
  createScreen?: () => ScreenView
}

interface PtyEntry {
  ptyId: string
  encodedPath: string
  sessionId: string
  /** Pending idle-fire timer; cleared whenever activity arrives or the PTY exits. */
  timer: unknown | null
  /**
   * Pending settle timer for Pattern-Matcher evaluation; re-armed on each
   * PTY chunk carrying data, cancelled on fire and on exit. (v9)
   */
  settleTimer: unknown | null
  /**
   * Per-Pty terminal screen the matchers read. Fed raw PTY bytes; classified
   * on settle. Disposed on PTY exit. (v9)
   */
  screen: ScreenView
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
      settleTimer: null,
      screen: (this.deps.createScreen ?? defaultCreateScreen)(),
      alreadyFired: false
    })
  }

  /**
   * Call on every PTY data chunk. Cancels the pending idle timer (if any),
   * re-arms a fresh one, and — if a notification had already fired for
   * the previous idle period — marks all that Session's unread rows
   * read since the agent is producing output again.
   *
   * When `data` is supplied (v9), the chunk is also fed to this Pty Tab's
   * screen and a short settle timer is (re-)armed; when it fires, the
   * screen is classified and, if a Pattern Matcher recognizes it, a
   * correctly-kinded notification fires immediately — ahead of the idle
   * floor. Omitting `data` (or passing empty) drives the pure v5 idle
   * behavior unchanged.
   */
  onPtyData(ptyId: string, data?: string): void {
    const entry = this.entries.get(ptyId)
    if (!entry) return
    if (entry.timer !== null) {
      this.deps.cancelTimeout(entry.timer)
      entry.timer = null
    }
    if (entry.settleTimer !== null) {
      this.deps.cancelTimeout(entry.settleTimer)
      entry.settleTimer = null
    }
    if (entry.alreadyFired) {
      this.autoMarkRead(entry.sessionId)
      entry.alreadyFired = false
    }
    if (data !== undefined && data.length > 0) {
      entry.screen.write(data)
      entry.settleTimer = this.deps.scheduleTimeout(() => {
        entry.settleTimer = null
        this.evaluate(entry)
      }, SETTLE_MS)
    }
    entry.timer = this.deps.scheduleTimeout(() => {
      this.fire(entry)
    }, IDLE_THRESHOLD_MS)
  }

  /**
   * Settle-timer callback: classify the current screen and, if a Pattern
   * Matcher recognizes it, fire that kind now (fire-first). A null
   * classification is a no-op — the idle timer remains armed as the
   * recall floor, so an unrecognized (or matcher-broken) screen degrades
   * to a generic `idle` notification rather than being swallowed
   * (ADR-0012 self-heal contract).
   */
  private evaluate(entry: PtyEntry): void {
    if (entry.alreadyFired) return
    // Foreground suppression: the user is already looking at this Pty Tab,
    // so don't fire a matched notification. Crucially, leave the idle
    // timer armed rather than cancelling it here — if they look away while
    // it's still idle, the recall floor still catches it (degraded to a
    // generic `idle`, never silently lost).
    if (this.foregroundPtyId === entry.ptyId) return
    const kind = classify(entry.screen.snapshot())
    if (kind === null) return
    this.fire(entry, kind)
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
    if (entry.settleTimer !== null) {
      this.deps.cancelTimeout(entry.settleTimer)
      entry.settleTimer = null
    }
    entry.screen.dispose()
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
      if (entry.settleTimer !== null) this.deps.cancelTimeout(entry.settleTimer)
      entry.screen.dispose()
    }
    this.entries.clear()
  }

  /**
   * Insert and (unless muted/foregrounded) emit one notification. Called
   * either by the idle timer — `kind` defaults to `'idle'`, the recall
   * floor — or by `evaluate()` when a Pattern Matcher recognized the
   * screen early, with the matched kind. Whichever fires first wins:
   * both timers are cancelled here and `alreadyFired` disarms the other,
   * so a single idle period yields exactly one notification.
   */
  private fire(entry: PtyEntry, kind: NotificationKind = 'idle'): void {
    if (entry.timer !== null) {
      this.deps.cancelTimeout(entry.timer)
      entry.timer = null
    }
    if (entry.settleTimer !== null) {
      this.deps.cancelTimeout(entry.settleTimer)
      entry.settleTimer = null
    }
    // Foreground suppression — the user is already looking at this Pty
    // Tab; no need to interrupt their gaze with a toast they don't
    // need. Both the toast AND the SQLite row are suppressed in this
    // case (different from mute, where the row is still stored).
    if (this.foregroundPtyId === entry.ptyId) return
    // Debounce — should never re-enter here within the same idle
    // period because the timers are cancelled on every data chunk and
    // on exit, but guard explicitly.
    if (entry.alreadyFired) return
    entry.alreadyFired = true

    const id = this.deps.generateId()
    const createdAt = this.deps.nowIso ? this.deps.nowIso() : new Date(this.deps.now()).toISOString()
    const row: Notification = insertNotification(this.deps.db, {
      id,
      createdAt,
      encodedPath: entry.encodedPath,
      sessionId: entry.sessionId,
      ptyId: entry.ptyId,
      kind,
      labelText: DEFAULT_KIND_LABEL[kind] ?? DEFAULT_KIND_LABEL.idle
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
