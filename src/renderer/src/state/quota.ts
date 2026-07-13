/**
 * Renderer-side cache of the account-global Claude Quota (v7 / Slice 51,
 * ADR-0011). Zustand vanilla store, matching the v6 store-per-domain
 * pattern (ADR-0007).
 *
 * Pull-based: there is no push channel. Quota is fetched on demand in
 * main (with its own ~5-min cache), so the renderer just calls
 * `refresh` on mount, on window focus, and on an interval. `snapshot`
 * is `null` whenever the feature is disabled, has no credential, or the
 * fetch failed — the chip renders nothing in that case.
 */

import { createStore, type StoreApi } from 'zustand/vanilla'
import type { MeshApi } from '@shared/api'
import type { QuotaSnapshot } from '@shared/types'

type QuotaApi = Pick<MeshApi['quota'], 'getSnapshot' | 'isEnabled' | 'setEnabled'>

export interface QuotaState {
  enabled: boolean
  snapshot: QuotaSnapshot | null

  /** Load the persisted opt-in flag (once, on bootstrap). */
  loadEnabled(): Promise<void>
  /** Re-fetch the snapshot from main. No-op to `null` when disabled. */
  refresh(): Promise<void>
  /** Write-through the opt-in, then refresh (enabling triggers the first fetch). */
  setEnabled(value: boolean): Promise<void>
}

export interface QuotaDeps {
  /** Production: `() => window.api.quota`. Tests inject a fake. */
  api: () => QuotaApi
}

export type QuotaStore = StoreApi<QuotaState>

export function createQuotaStore(deps: QuotaDeps): QuotaStore {
  return createStore<QuotaState>()((set, get) => ({
    enabled: false,
    snapshot: null,

    loadEnabled: async () => {
      set({ enabled: await deps.api().isEnabled() })
    },

    refresh: async () => {
      if (!get().enabled) {
        set({ snapshot: null })
        return
      }
      set({ snapshot: await deps.api().getSnapshot() })
    },

    setEnabled: async (value) => {
      await deps.api().setEnabled(value)
      set({ enabled: value })
      await get().refresh()
    }
  }))
}
