/**
 * Registry of live Pty Tabs across all Workspaces (Slice 39, v5;
 * converted to a Zustand vanilla store in Slice 48, v6 — ADR-0007).
 *
 * Each entry represents one Pty Tab that has been Resumed and is still
 * alive: its `node-pty` process is running, the renderer holds an open
 * subscription, and the user may navigate away without losing it. The
 * registry replaces `WorkspaceScreen`'s former local `ptyTabs` state so
 * the Home Screen surfaces (sidebar, ProjectCards, Detail pane) can
 * read it, and so tabs survive Project navigation — `WorkspaceScreen`
 * is `key`ed by `encodedPath` and unmounts on Project switch.
 *
 * Pure data — no React, no DOM, no `window`. The React bindings live
 * in `hooks/useLiveSessions.tsx`. Mutations that would not change
 * anything (duplicate add, same-value update, unknown slot) return
 * before `set`, so subscribers are only notified on real changes.
 */

import { createStore, type StoreApi } from 'zustand/vanilla'

export interface LiveTab {
  /** Synthetic id assigned before the pty spawns so React keying is stable. */
  slotId: string
  encodedPath: string
  sessionId: string
  /** Filled in once `pty.create` returns. Until then, key by `slotId`. */
  ptyId: string | null
  /** ms epoch of the most recent PTY output chunk. */
  lastActivityAt: number
}

export interface LiveSessionsSnapshot {
  tabs: ReadonlyArray<LiveTab>
}

export interface LiveSessionsState extends LiveSessionsSnapshot {
  add(input: {
    slotId: string
    encodedPath: string
    sessionId: string
    lastActivityAt: number
  }): void
  updatePtyId(slotId: string, ptyId: string): void
  markActivity(slotId: string, atMs: number): void
  remove(slotId: string): void
}

export type LiveSessionsStore = StoreApi<LiveSessionsState>

export function createLiveSessionsStore(): LiveSessionsStore {
  return createStore<LiveSessionsState>()((set, get) => ({
    tabs: [],

    add: (input) => {
      if (get().tabs.some((t) => t.slotId === input.slotId)) return
      set((s) => ({ tabs: [...s.tabs, { ...input, ptyId: null }] }))
    },

    updatePtyId: (slotId, ptyId) => {
      const existing = get().tabs.find((t) => t.slotId === slotId)
      if (!existing || existing.ptyId === ptyId) return
      set((s) => ({
        tabs: s.tabs.map((t) => (t.slotId === slotId ? { ...t, ptyId } : t))
      }))
    },

    markActivity: (slotId, atMs) => {
      const existing = get().tabs.find((t) => t.slotId === slotId)
      if (!existing || existing.lastActivityAt === atMs) return
      set((s) => ({
        tabs: s.tabs.map((t) => (t.slotId === slotId ? { ...t, lastActivityAt: atMs } : t))
      }))
    },

    remove: (slotId) => {
      if (!get().tabs.some((t) => t.slotId === slotId)) return
      set((s) => ({ tabs: s.tabs.filter((t) => t.slotId !== slotId) }))
    }
  }))
}

// --- Aggregation helpers (pure functions over a snapshot) ----------------

export function tabsForProject(
  snapshot: LiveSessionsSnapshot,
  encodedPath: string
): LiveTab[] {
  return snapshot.tabs.filter((t) => t.encodedPath === encodedPath)
}

export function tabsForSession(
  snapshot: LiveSessionsSnapshot,
  sessionId: string
): LiveTab[] {
  return snapshot.tabs.filter((t) => t.sessionId === sessionId)
}

export function isSessionLive(
  snapshot: LiveSessionsSnapshot,
  sessionId: string
): boolean {
  return snapshot.tabs.some((t) => t.sessionId === sessionId)
}

export function isProjectLive(
  snapshot: LiveSessionsSnapshot,
  encodedPath: string
): boolean {
  return snapshot.tabs.some((t) => t.encodedPath === encodedPath)
}

/**
 * Newest `lastActivityAt` across all tabs for a Session, or `null` if
 * the Session has no live tab. Used to drive the "is currently
 * producing output?" check — combined with a `now` timestamp + recency
 * window, callers decide whether to render the spinner.
 */
export function maxActivityForSession(
  snapshot: LiveSessionsSnapshot,
  sessionId: string
): number | null {
  let max: number | null = null
  for (const t of snapshot.tabs) {
    if (t.sessionId !== sessionId) continue
    if (max === null || t.lastActivityAt > max) max = t.lastActivityAt
  }
  return max
}

export function maxActivityForProject(
  snapshot: LiveSessionsSnapshot,
  encodedPath: string
): number | null {
  let max: number | null = null
  for (const t of snapshot.tabs) {
    if (t.encodedPath !== encodedPath) continue
    if (max === null || t.lastActivityAt > max) max = t.lastActivityAt
  }
  return max
}

/**
 * Recency window matching `PtyTabBar.tsx`'s historical 2 s heuristic —
 * a PTY that emitted output within this many ms is rendered as
 * "currently active" (spinner on). Exported so the renderer's
 * indicator logic and the Slice 41 idle-detector (8 s) share the
 * constant family.
 */
export const SPINNER_RECENCY_MS = 2_000

export function isSessionActive(
  snapshot: LiveSessionsSnapshot,
  sessionId: string,
  nowMs: number
): boolean {
  const max = maxActivityForSession(snapshot, sessionId)
  return max !== null && nowMs - max < SPINNER_RECENCY_MS
}

export function isProjectActive(
  snapshot: LiveSessionsSnapshot,
  encodedPath: string,
  nowMs: number
): boolean {
  const max = maxActivityForProject(snapshot, encodedPath)
  return max !== null && nowMs - max < SPINNER_RECENCY_MS
}
