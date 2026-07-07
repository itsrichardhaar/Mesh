import { describe, it, expect } from 'vitest'
import {
  SPINNER_RECENCY_MS,
  createLiveSessionsStore,
  isProjectActive,
  isProjectLive,
  isSessionActive,
  isSessionLive,
  maxActivityForProject,
  maxActivityForSession,
  tabsForProject,
  tabsForSession
} from '../src/renderer/src/state/live-sessions'

// Slice 48 (v6): the hand-rolled registry converted to a Zustand
// vanilla store. Assertions carried over unchanged — `snapshot()`
// became `getState()`, mutators live on the state object, and
// zustand's `subscribe` replaced the bespoke listener set. The no-op
// semantics (duplicate add, same-value update, unknown slot) are
// still enforced by early returns before `set`.

const PROJECT_A = '-Users-rh-Desktop-A'
const PROJECT_B = '-Users-rh-Desktop-B'
const SESS_1 = 'sess-1111'
const SESS_2 = 'sess-2222'

describe('live-sessions store — Slice 39 semantics', () => {
  it('starts empty', () => {
    const r = createLiveSessionsStore()
    expect(r.getState().tabs).toEqual([])
  })

  it('adds a tab with null ptyId and the provided activity timestamp', () => {
    const r = createLiveSessionsStore()
    r.getState().add({ slotId: 's1', encodedPath: PROJECT_A, sessionId: SESS_1, lastActivityAt: 1000 })
    const tabs = r.getState().tabs
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toEqual({
      slotId: 's1',
      encodedPath: PROJECT_A,
      sessionId: SESS_1,
      ptyId: null,
      lastActivityAt: 1000
    })
  })

  it('ignores a second add with the same slotId', () => {
    const r = createLiveSessionsStore()
    r.getState().add({ slotId: 's1', encodedPath: PROJECT_A, sessionId: SESS_1, lastActivityAt: 1000 })
    r.getState().add({ slotId: 's1', encodedPath: PROJECT_B, sessionId: SESS_2, lastActivityAt: 9999 })
    expect(r.getState().tabs).toHaveLength(1)
    expect(r.getState().tabs[0]!.encodedPath).toBe(PROJECT_A)
  })

  it('updates ptyId on the matching slot', () => {
    const r = createLiveSessionsStore()
    r.getState().add({ slotId: 's1', encodedPath: PROJECT_A, sessionId: SESS_1, lastActivityAt: 1000 })
    r.getState().updatePtyId('s1', 'pty-abc')
    expect(r.getState().tabs[0]!.ptyId).toBe('pty-abc')
  })

  it('ignores updatePtyId for an unknown slot', () => {
    const r = createLiveSessionsStore()
    r.getState().add({ slotId: 's1', encodedPath: PROJECT_A, sessionId: SESS_1, lastActivityAt: 1000 })
    r.getState().updatePtyId('nope', 'pty-x')
    expect(r.getState().tabs[0]!.ptyId).toBeNull()
  })

  it('markActivity advances lastActivityAt', () => {
    const r = createLiveSessionsStore()
    r.getState().add({ slotId: 's1', encodedPath: PROJECT_A, sessionId: SESS_1, lastActivityAt: 1000 })
    r.getState().markActivity('s1', 5000)
    expect(r.getState().tabs[0]!.lastActivityAt).toBe(5000)
  })

  it('remove drops the slot', () => {
    const r = createLiveSessionsStore()
    r.getState().add({ slotId: 's1', encodedPath: PROJECT_A, sessionId: SESS_1, lastActivityAt: 1000 })
    r.getState().add({ slotId: 's2', encodedPath: PROJECT_A, sessionId: SESS_2, lastActivityAt: 2000 })
    r.getState().remove('s1')
    expect(r.getState().tabs).toHaveLength(1)
    expect(r.getState().tabs[0]!.slotId).toBe('s2')
  })

  it('notifies subscribers on every mutation and not on no-ops', () => {
    const r = createLiveSessionsStore()
    let calls = 0
    const off = r.subscribe(() => {
      calls += 1
    })
    r.getState().add({ slotId: 's1', encodedPath: PROJECT_A, sessionId: SESS_1, lastActivityAt: 1000 })
    expect(calls).toBe(1)
    r.getState().add({ slotId: 's1', encodedPath: PROJECT_A, sessionId: SESS_1, lastActivityAt: 9 }) // dup — no-op
    expect(calls).toBe(1)
    r.getState().updatePtyId('s1', 'pty-abc')
    expect(calls).toBe(2)
    r.getState().updatePtyId('s1', 'pty-abc') // same value — no-op
    expect(calls).toBe(2)
    r.getState().markActivity('s1', 5000)
    expect(calls).toBe(3)
    r.getState().markActivity('s1', 5000) // same value — no-op
    expect(calls).toBe(3)
    r.getState().remove('s1')
    expect(calls).toBe(4)
    r.getState().remove('s1') // already gone — no-op
    expect(calls).toBe(4)
    off()
  })

  it('returns referentially-stable state between mutations', () => {
    const r = createLiveSessionsStore()
    r.getState().add({ slotId: 's1', encodedPath: PROJECT_A, sessionId: SESS_1, lastActivityAt: 1000 })
    const a = r.getState()
    const b = r.getState()
    expect(a).toBe(b)
    r.getState().markActivity('s1', 2000)
    const c = r.getState()
    expect(c).not.toBe(a)
  })

  it('unsubscribe stops further notifications', () => {
    const r = createLiveSessionsStore()
    let calls = 0
    const off = r.subscribe(() => {
      calls += 1
    })
    r.getState().add({ slotId: 's1', encodedPath: PROJECT_A, sessionId: SESS_1, lastActivityAt: 1000 })
    expect(calls).toBe(1)
    off()
    r.getState().remove('s1')
    expect(calls).toBe(1)
  })
})

describe('LiveSessions aggregation helpers — Slice 39', () => {
  function build(): ReturnType<typeof createLiveSessionsStore> {
    const r = createLiveSessionsStore()
    r.getState().add({ slotId: 's1', encodedPath: PROJECT_A, sessionId: SESS_1, lastActivityAt: 1000 })
    r.getState().add({ slotId: 's2', encodedPath: PROJECT_A, sessionId: SESS_1, lastActivityAt: 3000 }) // 2nd tab same session
    r.getState().add({ slotId: 's3', encodedPath: PROJECT_A, sessionId: SESS_2, lastActivityAt: 2000 })
    r.getState().add({ slotId: 's4', encodedPath: PROJECT_B, sessionId: SESS_1, lastActivityAt: 500 })
    return r
  }

  it('tabsForProject filters by encodedPath', () => {
    const r = build()
    const a = tabsForProject(r.getState(), PROJECT_A)
    const b = tabsForProject(r.getState(), PROJECT_B)
    expect(a.map((t) => t.slotId).sort()).toEqual(['s1', 's2', 's3'])
    expect(b.map((t) => t.slotId)).toEqual(['s4'])
  })

  it('tabsForSession filters by sessionId across projects', () => {
    const r = build()
    const sess1 = tabsForSession(r.getState(), SESS_1)
    expect(sess1.map((t) => t.slotId).sort()).toEqual(['s1', 's2', 's4'])
  })

  it('isSessionLive is true iff at least one tab exists for the session', () => {
    const r = build()
    expect(isSessionLive(r.getState(), SESS_1)).toBe(true)
    expect(isSessionLive(r.getState(), 'sess-never')).toBe(false)
  })

  it('isProjectLive is true iff at least one tab exists for the project', () => {
    const r = build()
    expect(isProjectLive(r.getState(), PROJECT_A)).toBe(true)
    expect(isProjectLive(r.getState(), PROJECT_B)).toBe(true)
    expect(isProjectLive(r.getState(), '-Users-rh-Desktop-Other')).toBe(false)
  })

  it('maxActivityForSession picks the newest across all of a session’s tabs', () => {
    const r = build()
    expect(maxActivityForSession(r.getState(), SESS_1)).toBe(3000) // s2 newer than s1 (and beats s4 in PROJECT_B)
    expect(maxActivityForSession(r.getState(), SESS_2)).toBe(2000)
    expect(maxActivityForSession(r.getState(), 'sess-never')).toBeNull()
  })

  it('maxActivityForProject picks the newest across all of a project’s tabs', () => {
    const r = build()
    expect(maxActivityForProject(r.getState(), PROJECT_A)).toBe(3000) // s2 is newest in A
    expect(maxActivityForProject(r.getState(), PROJECT_B)).toBe(500) // s4
    expect(maxActivityForProject(r.getState(), 'nope')).toBeNull()
  })

  it('isSessionActive uses the 2 s recency window vs the supplied now', () => {
    const r = createLiveSessionsStore()
    r.getState().add({ slotId: 's1', encodedPath: PROJECT_A, sessionId: SESS_1, lastActivityAt: 10_000 })
    // Now = 10_000 + 1_000 → still inside the window
    expect(isSessionActive(r.getState(), SESS_1, 10_000 + 1_000)).toBe(true)
    // Now = 10_000 + SPINNER_RECENCY_MS → exactly at the edge → considered idle
    expect(isSessionActive(r.getState(), SESS_1, 10_000 + SPINNER_RECENCY_MS)).toBe(false)
    // Far in the future
    expect(isSessionActive(r.getState(), SESS_1, 10_000 + 10_000)).toBe(false)
  })

  it('isProjectActive mirrors isSessionActive at the project rollup', () => {
    const r = createLiveSessionsStore()
    r.getState().add({ slotId: 's1', encodedPath: PROJECT_A, sessionId: SESS_1, lastActivityAt: 1000 })
    r.getState().add({ slotId: 's2', encodedPath: PROJECT_A, sessionId: SESS_2, lastActivityAt: 9000 }) // newer
    // Inside window vs the newer tab (s2)
    expect(isProjectActive(r.getState(), PROJECT_A, 9000 + 500)).toBe(true)
    // Outside window vs s2 even though s1 is much further out
    expect(isProjectActive(r.getState(), PROJECT_A, 9000 + SPINNER_RECENCY_MS + 1)).toBe(false)
    // Empty project
    expect(isProjectActive(r.getState(), 'nope', 9000)).toBe(false)
  })

  it('removing a tab updates aggregation correctly', () => {
    const r = build()
    r.getState().remove('s2') // session SESS_1 in PROJECT_A drops from 2 tabs to 1
    expect(tabsForProject(r.getState(), PROJECT_A).map((t) => t.slotId).sort()).toEqual(['s1', 's3'])
    expect(maxActivityForSession(r.getState(), SESS_1)).toBe(1000) // s1's value now wins
    r.getState().remove('s1')
    // SESS_1 in PROJECT_A has no tabs anymore, but s4 (PROJECT_B) still references SESS_1
    expect(isSessionLive(r.getState(), SESS_1)).toBe(true)
    expect(isProjectLive(r.getState(), PROJECT_A)).toBe(true) // s3 still alive
    r.getState().remove('s3')
    expect(isProjectLive(r.getState(), PROJECT_A)).toBe(false)
  })
})
