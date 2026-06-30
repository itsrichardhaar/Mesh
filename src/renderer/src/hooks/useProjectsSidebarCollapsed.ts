import { useCallback, useEffect, useState } from 'react'

const SETTING_KEY = 'home.projectsSidebarCollapsed'
const DEFAULT_COLLAPSED = false

/**
 * Global Home Screen projects-sidebar collapse state. Mirrors
 * `useFileTreeCollapsed` (Slice 23) — persisted via the `settings`
 * table under a single key, hydrated async, defaults to `expanded`
 * until the stored value loads. The top bar's sidebar-toggle button
 * reads/writes this when the active screen is Home (or the Home
 * detail view).
 *
 * The settings IPC only accepts string values, so the boolean is
 * encoded as `'true'` / `'false'`.
 */
export function useProjectsSidebarCollapsed(): {
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
