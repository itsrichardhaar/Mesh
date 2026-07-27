/**
 * Renderer cache of the Usage dashboard (v7 / Slice 54; filterable in v10 /
 * ADR-0013). Zustand vanilla store (ADR-0007). Pull-based: `loadDashboard`
 * fetches the one-round-trip payload from main. The metric toggle and
 * granularity are client-side and never re-fetch; changing the Usage
 * Filter's Timeframe re-fetches (the scoping happens in main).
 */

import { createStore, type StoreApi } from 'zustand/vanilla'
import type { MeshApi } from '@shared/api'
import type { UsageDashboard, UsageTimeframe } from '@shared/types'
import type { Granularity } from '../util/trend'

type UsageApi = Pick<MeshApi['usage'], 'getDashboard'>

export interface UsageState {
  dashboard: UsageDashboard | null
  /** True while main is (re)building the cache — drives the shimmer. */
  indexing: boolean
  metric: 'tokens' | 'cost'
  granularity: Granularity
  /** Usage Filter: date window. Changing it re-fetches (ADR-0013). */
  timeframe: UsageTimeframe
  /** Usage Filter: selected Project (Encoded Path), or null = all. Re-fetches. */
  project: string | null

  loadDashboard(): Promise<void>
  setIndexing(value: boolean): void
  setMetric(metric: 'tokens' | 'cost'): void
  setGranularity(granularity: Granularity): void
  setTimeframe(timeframe: UsageTimeframe): void
  setProject(project: string | null): void
}

export interface UsageDeps {
  api: () => UsageApi
}

export type UsageStore = StoreApi<UsageState>

export function createUsageStore(deps: UsageDeps): UsageStore {
  return createStore<UsageState>()((set, get) => ({
    dashboard: null,
    indexing: false,
    metric: 'tokens',
    granularity: 'day',
    timeframe: 'month',
    project: null,

    // The Usage Filter is applied in main; metric + granularity stay
    // client-side and do NOT re-fetch. Timeframe and Project do.
    loadDashboard: async () => {
      const dashboard = await deps.api().getDashboard({
        timeframe: get().timeframe,
        encodedPath: get().project
      })
      set({ dashboard })
    },
    setIndexing: (value) => set({ indexing: value }),
    setMetric: (metric) => set({ metric }),
    setGranularity: (granularity) => set({ granularity }),
    setTimeframe: (timeframe) => {
      set({ timeframe })
      void get().loadDashboard()
    },
    setProject: (project) => {
      set({ project })
      void get().loadDashboard()
    }
  }))
}
