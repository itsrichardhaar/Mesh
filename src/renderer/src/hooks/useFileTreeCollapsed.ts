import { useCallback, useEffect, useState } from 'react'

const SETTING_KEY = 'workspace.fileTreeCollapsed'
const DEFAULT_COLLAPSED = false

/**
 * Global Workspace file-tree collapse state (Slice 23). Persisted via
 * the `settings` table under a single key — unlike `useWorkspaceMode`,
 * this preference is NOT per-Project. Most users settle on one
 * preference and don't toggle; per-Project persistence is overkill.
 *
 * The settings IPC only accepts string values, so the boolean is
 * encoded as `'true'` / `'false'`. Hydration is async; until the
 * stored value loads we render with the default (`expanded`).
 */
export function useFileTreeCollapsed(): {
  collapsed: boolean
  setCollapsed: (next: boolean) => void
  toggle: () => void
} {
  const [collapsed, setCollapsedState] = useState<boolean>(DEFAULT_COLLAPSED)

  useEffect(() => {
    let cancelled = false
    void window.api.settings
      .get(SETTING_KEY)
      .then((stored) => {
        if (cancelled) return
        if (stored === 'true') setCollapsedState(true)
        else if (stored === 'false') setCollapsedState(false)
      })
      .catch(() => {
        /* Stay with the default. */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const persist = (next: boolean): void => {
    void window.api.settings.set(SETTING_KEY, next ? 'true' : 'false')
  }

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next)
    persist(next)
  }, [])

  const toggle = useCallback(() => {
    setCollapsedState((prev) => {
      const next = !prev
      persist(next)
      return next
    })
  }, [])

  return { collapsed, setCollapsed, toggle }
}
