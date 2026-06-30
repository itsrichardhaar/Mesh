import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  createLiveSessionsRegistry,
  isProjectActive,
  isProjectLive,
  isSessionActive,
  isSessionLive,
  tabsForProject,
  type LiveSessionsRegistry,
  type LiveSessionsSnapshot,
  type LiveTab
} from '../state/live-sessions'

interface ContextValue {
  registry: LiveSessionsRegistry
}

const LiveSessionsContext = createContext<ContextValue | null>(null)

/**
 * App-level provider that owns the live-PTY registry for the lifetime
 * of the renderer. Mounted in `App.tsx` above the screen switch so the
 * value survives `WorkspaceScreen` unmount (it remounts on Project
 * switch because it's `key`ed by `encodedPath`).
 */
export function LiveSessionsProvider({ children }: { children: ReactNode }): JSX.Element {
  const value = useMemo<ContextValue>(() => ({ registry: createLiveSessionsRegistry() }), [])

  // Global PTY-event subscriptions that own the registry's lifecycle
  // independent of any `WorkspaceScreen` mount. Activity updates +
  // exit cleanup must keep flowing while the user is on Home Screen
  // or Settings — otherwise the Home Screen indicators (Slice 40) and
  // Project-survival across navigation would both break.
  useEffect(() => {
    const { registry } = value
    const offData = window.api.pty.onData((event) => {
      const now = Date.now()
      for (const t of registry.snapshot().tabs) {
        if (t.ptyId === event.ptyId) registry.markActivity(t.slotId, now)
      }
    })
    const offExit = window.api.pty.onExit((event) => {
      for (const t of registry.snapshot().tabs) {
        if (t.ptyId === event.ptyId) registry.remove(t.slotId)
      }
    })
    return () => {
      offData()
      offExit()
    }
  }, [value])

  return <LiveSessionsContext.Provider value={value}>{children}</LiveSessionsContext.Provider>
}

function useRegistry(): LiveSessionsRegistry {
  const ctx = useContext(LiveSessionsContext)
  if (!ctx) {
    throw new Error('useLiveSessions: missing <LiveSessionsProvider> above this component')
  }
  return ctx.registry
}

function useSnapshot(): LiveSessionsSnapshot {
  const registry = useRegistry()
  return useSyncExternalStore(
    (listener) => registry.subscribe(listener),
    () => registry.snapshot(),
    () => registry.snapshot()
  )
}

/**
 * Re-renders every `intervalMs` so consumers' "is currently active?"
 * checks (which compare `Date.now() - lastActivityAt` against the 2 s
 * recency window) update without the snapshot itself changing. Matches
 * the existing `PtyTabBar.tsx` ●-dot pattern. 500 ms tick is a good
 * compromise between responsiveness and renderer churn.
 */
function useActivityTick(intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/**
 * Imperative registry actions — for `WorkspaceScreen` to call when the
 * user Resumes a session, when a PTY's ptyId resolves, when activity
 * arrives, or when a tab exits. Stable identity across renders.
 */
export function useLiveSessionsActions(): {
  addTab: (input: { slotId: string; encodedPath: string; sessionId: string }) => void
  setPtyId: (slotId: string, ptyId: string) => void
  markActivity: (slotId: string) => void
  removeTab: (slotId: string) => void
} {
  const registry = useRegistry()
  const ref = useRef(registry)
  ref.current = registry
  return useMemo(
    () => ({
      addTab: (input) => ref.current.add({ ...input, lastActivityAt: Date.now() }),
      setPtyId: (slotId, ptyId) => ref.current.updatePtyId(slotId, ptyId),
      markActivity: (slotId) => ref.current.markActivity(slotId, Date.now()),
      removeTab: (slotId) => ref.current.remove(slotId)
    }),
    []
  )
}

/**
 * Subscribes to the registry; returns the current snapshot. Re-renders
 * on every registry mutation.
 */
export function useLiveSessionsSnapshot(): LiveSessionsSnapshot {
  return useSnapshot()
}

/**
 * All live tabs scoped to one Project's `encodedPath`. `WorkspaceScreen`
 * uses this to render its tab bar without seeing other Projects' tabs.
 */
export function useLiveTabsForProject(encodedPath: string): LiveTab[] {
  const snapshot = useSnapshot()
  return useMemo(() => tabsForProject(snapshot, encodedPath), [snapshot, encodedPath])
}

/**
 * Per-Session indicator state — drives the green tint + spinner on
 * `SessionsList`'s rows. `isLive` is sticky (tab exists); `isActive`
 * is transient (output within 2 s).
 */
export function useSessionIndicator(sessionId: string): { isLive: boolean; isActive: boolean } {
  const snapshot = useSnapshot()
  const now = useActivityTick()
  return {
    isLive: isSessionLive(snapshot, sessionId),
    isActive: isSessionActive(snapshot, sessionId, now)
  }
}

/**
 * Per-Project indicator state — drives the green tint + spinner on
 * the Home Screen surfaces (ProjectSidebar, ProjectCards, Detail pane).
 * Wired in Slice 40; exposed here so the hook surface is complete.
 */
export function useProjectIndicator(encodedPath: string): { isLive: boolean; isActive: boolean } {
  const snapshot = useSnapshot()
  const now = useActivityTick()
  return {
    isLive: isProjectLive(snapshot, encodedPath),
    isActive: isProjectActive(snapshot, encodedPath, now)
  }
}
