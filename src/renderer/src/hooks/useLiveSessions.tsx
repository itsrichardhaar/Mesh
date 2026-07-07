import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import {
  createLiveSessionsStore,
  isProjectActive,
  isProjectLive,
  isSessionActive,
  isSessionLive,
  tabsForProject,
  type LiveTab
} from '../state/live-sessions'

/**
 * The App's live-sessions store instance (Slice 48 / v6, ADR-0007) —
 * one per renderer lifetime, so Pty Tabs survive `WorkspaceScreen`
 * unmounts (it remounts on Project switch because it's `key`ed by
 * `encodedPath`). Replaces the former context provider + hand-rolled
 * subscriber registry.
 */
export const liveSessionsStore = createLiveSessionsStore()

/**
 * Event bridge, formerly the context provider. Owns the global PTY
 * subscriptions independent of any `WorkspaceScreen` mount: activity
 * updates + exit cleanup must keep flowing while the user is on Home
 * Screen or Settings — otherwise the Home Screen indicators (Slice 40)
 * and tab survival across navigation would both break.
 */
export function LiveSessionsProvider({ children }: { children: ReactNode }): JSX.Element {
  useEffect(() => {
    const offData = window.api.pty.onData((event) => {
      const now = Date.now()
      const state = liveSessionsStore.getState()
      for (const t of state.tabs) {
        if (t.ptyId === event.ptyId) state.markActivity(t.slotId, now)
      }
    })
    const offExit = window.api.pty.onExit((event) => {
      const state = liveSessionsStore.getState()
      for (const t of state.tabs) {
        if (t.ptyId === event.ptyId) state.remove(t.slotId)
      }
    })
    return () => {
      offData()
      offExit()
    }
  }, [])

  return <>{children}</>
}

/**
 * Imperative registry actions — for `WorkspaceScreen` to call when the
 * user Resumes a session or when a PTY's ptyId resolves. Stable
 * identity across renders.
 */
export function useLiveSessionsActions(): {
  addTab: (input: { slotId: string; encodedPath: string; sessionId: string }) => void
  setPtyId: (slotId: string, ptyId: string) => void
  markActivity: (slotId: string) => void
  removeTab: (slotId: string) => void
} {
  return useMemo(
    () => ({
      addTab: (input) =>
        liveSessionsStore.getState().add({ ...input, lastActivityAt: Date.now() }),
      setPtyId: (slotId, ptyId) => liveSessionsStore.getState().updatePtyId(slotId, ptyId),
      markActivity: (slotId) => liveSessionsStore.getState().markActivity(slotId, Date.now()),
      removeTab: (slotId) => liveSessionsStore.getState().remove(slotId)
    }),
    []
  )
}

/**
 * All live tabs scoped to one Project's `encodedPath`. Shallow-compared
 * so consumers re-render only when one of *their* Project's tabs
 * changes — other Projects' activity doesn't touch them.
 */
export function useLiveTabsForProject(encodedPath: string): LiveTab[] {
  return useStore(
    liveSessionsStore,
    useShallow((s) => tabsForProject(s, encodedPath))
  )
}

/**
 * Boolean recency flag driven by store changes + a 500 ms tick (the
 * spinner has to turn OFF when output stops, without any store
 * mutation happening). State updates bail out when the flag hasn't
 * flipped, so neither PTY chunks nor ticks re-render consumers whose
 * indicator state is unchanged.
 */
function useRecencyFlag(compute: (nowMs: number) => boolean, intervalMs = 500): boolean {
  const [flag, setFlag] = useState(() => compute(Date.now()))
  useEffect(() => {
    const update = (): void => setFlag(compute(Date.now()))
    update()
    const timer = setInterval(update, intervalMs)
    const off = liveSessionsStore.subscribe(update)
    return () => {
      clearInterval(timer)
      off()
    }
  }, [compute, intervalMs])
  return flag
}

/**
 * Per-Session indicator state — drives the green tint + spinner on
 * `SessionsList`'s rows. `isLive` is sticky (tab exists); `isActive`
 * is transient (output within 2 s).
 */
export function useSessionIndicator(sessionId: string): { isLive: boolean; isActive: boolean } {
  const isLive = useStore(liveSessionsStore, (s) => isSessionLive(s, sessionId))
  const compute = useCallback(
    (nowMs: number) => isSessionActive(liveSessionsStore.getState(), sessionId, nowMs),
    [sessionId]
  )
  return { isLive, isActive: useRecencyFlag(compute) }
}

/**
 * Per-Project indicator state — drives the green tint + spinner on
 * the Home Screen surfaces (ProjectSidebar, ProjectCards, Detail pane).
 */
export function useProjectIndicator(encodedPath: string): { isLive: boolean; isActive: boolean } {
  const isLive = useStore(liveSessionsStore, (s) => isProjectLive(s, encodedPath))
  const compute = useCallback(
    (nowMs: number) => isProjectActive(liveSessionsStore.getState(), encodedPath, nowMs),
    [encodedPath]
  )
  return { isLive, isActive: useRecencyFlag(compute) }
}
