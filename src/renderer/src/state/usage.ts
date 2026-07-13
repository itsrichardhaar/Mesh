/**
 * Renderer cache of the global Usage dashboard (v7 / Slice 54). Zustand
 * vanilla store (ADR-0007). Pull-based: `loadDashboard` fetches the
 * one-round-trip payload from main; the view state (metric / granularity
 * / range) lives here so toggles don't refetch. Selector-based bindings
 * keep high-frequency ingest churn from over-rendering.
 */

import { createStore, type StoreApi } from 'zustand/vanilla'
import type { MeshApi } from '@shared/api'
import type { UsageDashboard } from '@shared/types'
import type { Granularity, Range } from '../util/trend'

type UsageApi = Pick<MeshApi['usage'], 'getDashboard'>

export interface UsageState {
  dashboard: UsageDashboard | null
  /** True while main is (re)building the cache — drives the shimmer. */
  indexing: boolean
  metric: 'tokens' | 'cost'
  granularity: Granularity
  range: Range

  loadDashboard(): Promise<void>
  setIndexing(value: boolean): void
  setMetric(metric: 'tokens' | 'cost'): void
  setGranularity(granularity: Granularity): void
  setRange(range: Range): void
}

export interface UsageDeps {
  api: () => UsageApi
}

export type UsageStore = StoreApi<UsageState>

export function createUsageStore(deps: UsageDeps): UsageStore {
  return createStore<UsageState>()((set) => ({
    dashboard: null,
    indexing: false,
    metric: 'tokens',
    granularity: 'day',
    range: '30d',

    loadDashboard: async () => {
      set({ dashboard: await deps.api().getDashboard() })
    },
    setIndexing: (value) => set({ indexing: value }),
    setMetric: (metric) => set({ metric }),
    setGranularity: (granularity) => set({ granularity }),
    setRange: (range) => set({ range })
  }))
}
