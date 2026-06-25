import { useCallback, useEffect, useState } from 'react'

export type WorkspaceMode = 'sessions' | 'editor'

const DEFAULT_MODE: WorkspaceMode = 'sessions'

function isWorkspaceMode(v: unknown): v is WorkspaceMode {
  return v === 'sessions' || v === 'editor'
}

function settingKey(encodedPath: string): string {
  return `workspace.mode:${encodedPath}`
}

/**
 * Per-Project Mode Tab choice, persisted via the `settings` table.
 * Defaults to `sessions` for any Project that hasn't been touched in
 * File Editor mode before. Hydration is async; until the stored value
 * loads we render with the default so the UI is responsive — a brief
 * tab flip would only happen if the user happened to be staring at
 * the tab on first open of a File-Editor-defaulted Project.
 */
export function useWorkspaceMode(
  encodedPath: string
): { mode: WorkspaceMode; setMode: (next: WorkspaceMode) => void; ready: boolean } {
  const [mode, setModeState] = useState<WorkspaceMode>(DEFAULT_MODE)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    setReady(false)
    void window.api.settings
      .get(settingKey(encodedPath))
      .then((stored) => {
        if (cancelled) return
        setModeState(isWorkspaceMode(stored) ? stored : DEFAULT_MODE)
        setReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [encodedPath])

  const setMode = useCallback(
    (next: WorkspaceMode) => {
      setModeState(next)
      void window.api.settings.set(settingKey(encodedPath), next)
    },
    [encodedPath]
  )

  return { mode, setMode, ready }
}
