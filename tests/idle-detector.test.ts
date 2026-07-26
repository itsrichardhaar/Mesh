import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@main/db/migrations'
import {
  IDLE_THRESHOLD_MS,
  SETTLE_MS,
  IdleDetector,
  type ScreenView
} from '@main/notifications/idle-detector'
import { listNotifications, unreadCount } from '@main/notifications/repository'

/**
 * Synchronous fake screen: each write REPLACES the current frame (Ink
 * repaints wholesale, and the real ScreenModel's snapshot is latest-frame-
 * wins — see screen-model.test.ts). So a test drives the matcher path by
 * passing a full frame's text as the `data` argument (no ANSI, no xterm,
 * no async). ANSI decoding + real matching live in screen-model.test.ts /
 * matchers.test.ts.
 */
function fakeScreenFactory(): () => ScreenView {
  return () => {
    let frame = ''
    return {
      write: (bytes) => {
        frame = bytes
      },
      snapshot: () => frame,
      dispose: () => {}
    }
  }
}

const APPROVAL_FRAME = 'Do you want to proceed?\n❯ 1. Yes\n  2. No, and tell Claude what to do differently'
const COMPLETE_FRAME = "I'm done.\n  ? for shortcuts"

const PROJECT_A = '-Users-rh-Desktop-A'
const SESS_1 = 'sess-1111'

interface ManualScheduler {
  schedule: (cb: () => void, ms: number) => unknown
  cancel: (timer: unknown) => void
  /** Fire any pending timer whose firing time <= `now`. */
  advanceTo(targetNowMs: number): void
  pendingCount(): number
}

function manualScheduler(getNow: () => number, setNow: (ms: number) => void): ManualScheduler {
  interface Entry { id: number; fireAt: number; cb: () => void; cancelled: boolean }
  const queue: Entry[] = []
  let next = 0
  return {
    schedule: (cb, ms) => {
      const entry: Entry = { id: ++next, fireAt: getNow() + ms, cb, cancelled: false }
      queue.push(entry)
      return entry
    },
    cancel: (timer) => {
      const entry = timer as Entry
      entry.cancelled = true
    },
    advanceTo: (targetNowMs) => {
      while (true) {
        const due = queue.filter((e) => !e.cancelled && e.fireAt <= targetNowMs)
          .sort((a, b) => a.fireAt - b.fireAt)
        if (due.length === 0) break
        const next = due[0]!
        // Drop everything up to and including this one's id from the queue.
        const idx = queue.indexOf(next)
        queue.splice(idx, 1)
        setNow(next.fireAt)
        next.cb()
      }
      setNow(targetNowMs)
    },
    pendingCount: () => queue.filter((e) => !e.cancelled).length
  }
}

interface Emitted {
  channel: 'notifications:created' | 'notifications:updated' | 'notifications:cleared'
  payload: unknown
}

function setup(opts: { startMs?: number; createScreen?: () => ScreenView } = {}) {
  const db = new Database(':memory:')
  runMigrations(db)
  let now = opts.startMs ?? 1_000_000
  const sched = manualScheduler(() => now, (next) => { now = next })
  const emitted: Emitted[] = []
  let idSeq = 0
  const detector = new IdleDetector({
    db,
    now: () => now,
    scheduleTimeout: sched.schedule,
    cancelTimeout: sched.cancel,
    emit: (channel, payload) => emitted.push({ channel, payload }),
    generateId: () => `id-${++idSeq}`,
    createScreen: opts.createScreen
  })
  return {
    db,
    detector,
    emitted,
    pending: () => sched.pendingCount(),
    advanceMs: (ms: number) => sched.advanceTo(now + ms),
    advanceTo: (target: number) => sched.advanceTo(target),
    getNow: () => now,
    close: () => db.close()
  }
}

describe('IdleDetector — Slice 41', () => {
  let env: ReturnType<typeof setup>
  beforeEach(() => {
    env = setup()
  })
  afterEach(() => {
    env.close()
  })

  it('does not fire when no PTYs have been registered', () => {
    env.advanceMs(IDLE_THRESHOLD_MS * 2)
    expect(env.emitted).toHaveLength(0)
  })

  it('fires exactly IDLE_THRESHOLD_MS after the last activity chunk', () => {
    env.detector.registerPty('pty-1', PROJECT_A, SESS_1)
    env.detector.onPtyData('pty-1')
    env.advanceMs(IDLE_THRESHOLD_MS - 1)
    expect(env.emitted).toHaveLength(0)
    env.advanceMs(1)
    expect(env.emitted).toHaveLength(1)
    expect(env.emitted[0]!.channel).toBe('notifications:created')
    const stored = listNotifications(env.db)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      encodedPath: PROJECT_A,
      sessionId: SESS_1,
      ptyId: 'pty-1',
      kind: 'idle',
      readAt: null
    })
  })

  it('further activity re-arms the timer (no fire while still active)', () => {
    env.detector.registerPty('pty-1', PROJECT_A, SESS_1)
    env.detector.onPtyData('pty-1')
    env.advanceMs(IDLE_THRESHOLD_MS - 100)
    env.detector.onPtyData('pty-1')
    env.advanceMs(IDLE_THRESHOLD_MS - 100)
    env.detector.onPtyData('pty-1')
    env.advanceMs(IDLE_THRESHOLD_MS - 100)
    expect(env.emitted).toHaveLength(0)
    env.advanceMs(100)
    expect(env.emitted).toHaveLength(1)
  })

  it('debounce: only one notification per idle period, no matter how long idle lasts', () => {
    env.detector.registerPty('pty-1', PROJECT_A, SESS_1)
    env.detector.onPtyData('pty-1')
    env.advanceMs(IDLE_THRESHOLD_MS)
    expect(env.emitted.filter((e) => e.channel === 'notifications:created')).toHaveLength(1)
    // Advance far beyond — no further fires.
    env.advanceMs(IDLE_THRESHOLD_MS * 10)
    expect(env.emitted.filter((e) => e.channel === 'notifications:created')).toHaveLength(1)
  })

  it('re-arms for a new notification after activity resumes and falls idle again', () => {
    env.detector.registerPty('pty-1', PROJECT_A, SESS_1)
    env.detector.onPtyData('pty-1')
    env.advanceMs(IDLE_THRESHOLD_MS)
    expect(env.emitted.filter((e) => e.channel === 'notifications:created')).toHaveLength(1)
    // Activity resumes — should auto-mark-read AND arm a new timer.
    env.detector.onPtyData('pty-1')
    const markReadEvents = env.emitted.filter((e) => e.channel === 'notifications:updated')
    expect(markReadEvents).toHaveLength(1)
    expect((markReadEvents[0]!.payload as { ids: string[] }).ids).toHaveLength(1)
    // Falls idle a second time — second notification fires.
    env.advanceMs(IDLE_THRESHOLD_MS)
    expect(env.emitted.filter((e) => e.channel === 'notifications:created')).toHaveLength(2)
  })

  it('suppresses notification when the PTY is foregrounded', () => {
    env.detector.registerPty('pty-1', PROJECT_A, SESS_1)
    env.detector.setForegroundPty('pty-1')
    env.detector.onPtyData('pty-1')
    env.advanceMs(IDLE_THRESHOLD_MS)
    expect(env.emitted).toHaveLength(0)
    // No row persisted either — foreground suppression is total.
    expect(listNotifications(env.db)).toHaveLength(0)
  })

  it('respects a foreground change made between activity and idle fire', () => {
    env.detector.registerPty('pty-1', PROJECT_A, SESS_1)
    env.detector.onPtyData('pty-1')
    // Timer is armed. Bring the tab to foreground partway through.
    env.advanceMs(IDLE_THRESHOLD_MS / 2)
    env.detector.setForegroundPty('pty-1')
    env.advanceMs(IDLE_THRESHOLD_MS / 2)
    expect(env.emitted).toHaveLength(0)
  })

  it('PTY exit cancels the pending timer and marks the session unread read', () => {
    env.detector.registerPty('pty-1', PROJECT_A, SESS_1)
    env.detector.onPtyData('pty-1')
    env.advanceMs(IDLE_THRESHOLD_MS)
    expect(env.emitted.filter((e) => e.channel === 'notifications:created')).toHaveLength(1)
    expect(unreadCount(env.db)).toBe(1)
    env.detector.onPtyExit('pty-1')
    // Auto-mark-read on exit.
    expect(env.emitted.filter((e) => e.channel === 'notifications:updated')).toHaveLength(1)
    expect(unreadCount(env.db)).toBe(0)
  })

  it('PTY exit during an armed-but-not-yet-fired window suppresses the fire', () => {
    env.detector.registerPty('pty-1', PROJECT_A, SESS_1)
    env.detector.onPtyData('pty-1')
    env.advanceMs(IDLE_THRESHOLD_MS / 2)
    env.detector.onPtyExit('pty-1')
    env.advanceMs(IDLE_THRESHOLD_MS)
    expect(env.emitted.filter((e) => e.channel === 'notifications:created')).toHaveLength(0)
  })

  it('shutdown cancels every pending timer; no fires after', () => {
    env.detector.registerPty('pty-1', PROJECT_A, SESS_1)
    env.detector.registerPty('pty-2', PROJECT_A, SESS_1)
    env.detector.onPtyData('pty-1')
    env.detector.onPtyData('pty-2')
    expect(env.pending()).toBe(2)
    env.detector.shutdown()
    expect(env.pending()).toBe(0)
    env.advanceMs(IDLE_THRESHOLD_MS * 2)
    expect(env.emitted).toHaveLength(0)
  })

  it('multiple PTYs operate independently', () => {
    env.detector.registerPty('pty-1', PROJECT_A, 'sess-A')
    env.detector.registerPty('pty-2', PROJECT_A, 'sess-B')
    env.detector.onPtyData('pty-1')
    env.advanceMs(IDLE_THRESHOLD_MS / 2)
    env.detector.onPtyData('pty-2')
    // pty-1 fires first
    env.advanceMs(IDLE_THRESHOLD_MS / 2)
    const created = env.emitted.filter((e) => e.channel === 'notifications:created')
    expect(created).toHaveLength(1)
    expect((created[0]!.payload as { ptyId: string }).ptyId).toBe('pty-1')
    // pty-2 fires next
    env.advanceMs(IDLE_THRESHOLD_MS / 2)
    const created2 = env.emitted.filter((e) => e.channel === 'notifications:created')
    expect(created2).toHaveLength(2)
  })

  it('mute (configured via configureMuteCheck) suppresses the toast event but persists the row', () => {
    let globalMute = false
    env.detector.configureMuteCheck(() => ({ global: globalMute, project: () => false }))
    env.detector.registerPty('pty-1', PROJECT_A, SESS_1)
    globalMute = true
    env.detector.onPtyData('pty-1')
    env.advanceMs(IDLE_THRESHOLD_MS)
    // No created event — toast suppressed.
    expect(env.emitted.filter((e) => e.channel === 'notifications:created')).toHaveLength(0)
    // But the row is in the DB — user can still see it in the dropdown.
    expect(listNotifications(env.db)).toHaveLength(1)
  })
})

describe('IdleDetector — pattern matchers (v9 / Slice 64)', () => {
  let env: ReturnType<typeof setup>
  beforeEach(() => {
    env = setup({ createScreen: fakeScreenFactory() })
  })
  afterEach(() => {
    env.close()
  })

  const createdKinds = () =>
    env.emitted
      .filter((e) => e.channel === 'notifications:created')
      .map((e) => (e.payload as { kind: string }).kind)

  it('fires an approval notification at the settle window, ahead of the idle floor', () => {
    env.detector.registerPty('pty-1', PROJECT_A, SESS_1)
    env.detector.onPtyData('pty-1', APPROVAL_FRAME)
    // Before settle: nothing yet.
    env.advanceMs(SETTLE_MS - 1)
    expect(env.emitted).toHaveLength(0)
    // At settle: the matcher fires — well before IDLE_THRESHOLD_MS.
    env.advanceMs(1)
    expect(createdKinds()).toEqual(['approval'])
    const stored = listNotifications(env.db)
    expect(stored[0]).toMatchObject({ kind: 'approval', labelText: 'Approval needed' })
  })

  it('fires a complete notification when the screen shows the ready prompt', () => {
    env.detector.registerPty('pty-1', PROJECT_A, SESS_1)
    env.detector.onPtyData('pty-1', COMPLETE_FRAME)
    env.advanceMs(SETTLE_MS)
    expect(createdKinds()).toEqual(['complete'])
  })

  it('a matcher fire dedups the idle floor — exactly one notification per period', () => {
    env.detector.registerPty('pty-1', PROJECT_A, SESS_1)
    env.detector.onPtyData('pty-1', APPROVAL_FRAME)
    env.advanceMs(SETTLE_MS)
    expect(createdKinds()).toEqual(['approval'])
    // Advance well past the idle threshold: the idle timer must NOT add a
    // second (generic) notification.
    env.advanceMs(IDLE_THRESHOLD_MS * 2)
    expect(createdKinds()).toEqual(['approval'])
  })

  it('falls through to the idle floor when the screen matches nothing (self-heal)', () => {
    env.detector.registerPty('pty-1', PROJECT_A, SESS_1)
    env.detector.onPtyData('pty-1', 'just some ordinary tool output, nothing to match here')
    // Settle passes with no match — no early fire.
    env.advanceMs(SETTLE_MS)
    expect(env.emitted).toHaveLength(0)
    // The idle floor still fires the generic notification.
    env.advanceMs(IDLE_THRESHOLD_MS - SETTLE_MS)
    expect(createdKinds()).toEqual(['idle'])
  })

  it('suppresses a matched notification entirely when the Pty Tab is foregrounded', () => {
    env.detector.registerPty('pty-1', PROJECT_A, SESS_1)
    env.detector.setForegroundPty('pty-1')
    env.detector.onPtyData('pty-1', APPROVAL_FRAME)
    env.advanceMs(SETTLE_MS)
    // Foreground suppression is total — no toast AND no row.
    expect(env.emitted).toHaveLength(0)
    expect(listNotifications(env.db)).toHaveLength(0)
  })

  it('a foreground-suppressed match leaves the idle floor armed (degrades, not lost)', () => {
    env.detector.registerPty('pty-1', PROJECT_A, SESS_1)
    env.detector.setForegroundPty('pty-1')
    env.detector.onPtyData('pty-1', APPROVAL_FRAME)
    env.advanceMs(SETTLE_MS)
    expect(env.emitted).toHaveLength(0)
    // User looks away while the prompt is still up — the recall floor must
    // still catch it (as a generic idle, since no new data re-classifies).
    env.detector.setForegroundPty(null)
    env.advanceMs(IDLE_THRESHOLD_MS - SETTLE_MS)
    expect(createdKinds()).toEqual(['idle'])
  })

  it('re-arms after an answered approval: activity resumes, then a completion fires next', () => {
    env.detector.registerPty('pty-1', PROJECT_A, SESS_1)
    env.detector.onPtyData('pty-1', APPROVAL_FRAME)
    env.advanceMs(SETTLE_MS)
    expect(createdKinds()).toEqual(['approval'])
    // User answers → PTY produces output again (auto-marks the approval read).
    env.detector.onPtyData('pty-1', 'running the command...')
    expect(env.emitted.filter((e) => e.channel === 'notifications:updated')).toHaveLength(1)
    // Claude finishes → a fresh complete notification fires.
    env.detector.onPtyData('pty-1', COMPLETE_FRAME)
    env.advanceMs(SETTLE_MS)
    expect(createdKinds()).toEqual(['approval', 'complete'])
  })

  it('drives pure idle behavior when onPtyData is called without data', () => {
    env.detector.registerPty('pty-1', PROJECT_A, SESS_1)
    env.detector.onPtyData('pty-1')
    env.advanceMs(IDLE_THRESHOLD_MS)
    expect(createdKinds()).toEqual(['idle'])
  })
})
