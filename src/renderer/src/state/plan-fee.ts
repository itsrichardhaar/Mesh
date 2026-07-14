/**
 * Renderer-side cache of the user's flat monthly plan fee (v8 / Slice
 * 60), backing Subscription Utilization. Zustand vanilla store (ADR-0007),
 * mirroring the quota store. Persisted as a plain string under the
 * generic `settings` key/value store; `null` means "not set" (the gauge
 * hides). No push channel — the Settings field write-throughs and both
 * the field and the Home gauge read this shared store.
 */

import { createStore, type StoreApi } from 'zustand/vanilla'
import type { MeshApi } from '@shared/api'

type SettingsApi = Pick<MeshApi['settings'], 'get' | 'set'>

/** The `settings` key the monthly plan fee is persisted under. */
export const PLAN_FEE_KEY = 'plan_fee_usd'

export interface PlanFeeState {
  /** The flat monthly plan fee in USD, or `null` when unset/blank. */
  planFeeUsd: number | null

  /** Load the persisted fee (once, on bootstrap). */
  load(): Promise<void>
  /** Write-through the fee; `null` clears it. Only positive numbers persist. */
  setPlanFee(value: number | null): Promise<void>
}

export interface PlanFeeDeps {
  /** Production: `() => window.api.settings`. Tests inject a fake. */
  settings: () => SettingsApi
}

export type PlanFeeStore = StoreApi<PlanFeeState>

/** Parse a stored string into a positive fee, or `null` (blank/invalid/≤0). */
function parseFee(raw: string | null): number | null {
  if (raw === null) return null
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function createPlanFeeStore(deps: PlanFeeDeps): PlanFeeStore {
  return createStore<PlanFeeState>()((set) => ({
    planFeeUsd: null,

    load: async () => {
      set({ planFeeUsd: parseFee(await deps.settings().get(PLAN_FEE_KEY)) })
    },

    setPlanFee: async (value) => {
      const fee = value !== null && Number.isFinite(value) && value > 0 ? value : null
      await deps.settings().set(PLAN_FEE_KEY, fee === null ? '' : String(fee))
      set({ planFeeUsd: fee })
    }
  }))
}
