import { useEffect, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { createUsageStore } from '../state/usage'

/** The App's usage-dashboard store instance (v7 / Slice 54). */
export const usageStore = createUsageStore({
  api: () => window.api.usage
})

/**
 * Loads the dashboard on mount and keeps it fresh: while main reports
 * `indexing` the shimmer shows; when ingest settles back to `idle`, the
 * dashboard reloads so new turns appear without a manual refresh.
 */
export function UsageProvider({ children }: { children: ReactNode }): JSX.Element {
  useEffect(() => {
    void usageStore.getState().loadDashboard()
    const unsub = window.api.usage.onStatusChanged((status) => {
      usageStore.getState().setIndexing(status.state === 'indexing')
      if (status.state === 'idle') void usageStore.getState().loadDashboard()
    })
    return unsub
  }, [])
  return <>{children}</>
}

export function useUsage() {
  const dashboard = useStore(usageStore, (s) => s.dashboard)
  const indexing = useStore(usageStore, (s) => s.indexing)
  const metric = useStore(usageStore, (s) => s.metric)
  const granularity = useStore(usageStore, (s) => s.granularity)
  const timeframe = useStore(usageStore, (s) => s.timeframe)
  const { setMetric, setGranularity, setTimeframe } = usageStore.getState()
  return { dashboard, indexing, metric, granularity, timeframe, setMetric, setGranularity, setTimeframe }
}
