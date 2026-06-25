import { useCallback, useEffect, useState } from 'react'
import type { Project } from '@shared/types'

export type ProjectListState =
  | { status: 'loading' }
  | { status: 'ok'; projects: Project[] }
  | { status: 'error'; message: string }

/**
 * Single source of truth for the Project sidebar's data. Lives on the
 * Home Screen so the right-pane detail can read the freshly-updated
 * Project (with cached `autoSubtitle` populated) after a list refresh.
 */
export function useProjectList(): {
  state: ProjectListState
  refresh: () => void
} {
  const [state, setState] = useState<ProjectListState>({ status: 'loading' })
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    window.api.projects
      .list()
      .then((projects) => {
        if (cancelled) return
        setState({ status: 'ok', projects })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err)
        })
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  return { state, refresh }
}
