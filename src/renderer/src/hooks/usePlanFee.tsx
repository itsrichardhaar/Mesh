import { useEffect, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { createPlanFeeStore } from '../state/plan-fee'

/**
 * The App's plan-fee store instance (v8 / Slice 60). `window.api` is
 * referenced lazily inside the deps closure, so importing this module
 * never touches the preload bridge.
 */
export const planFeeStore = createPlanFeeStore({
  settings: () => window.api.settings
})

/** Loads the persisted plan fee on mount so Settings + the Home gauge share it. */
export function PlanFeeProvider({ children }: { children: ReactNode }): JSX.Element {
  useEffect(() => {
    void planFeeStore.getState().load()
  }, [])
  return <>{children}</>
}

interface UsePlanFeeValue {
  planFeeUsd: number | null
  setPlanFee: (value: number | null) => Promise<void>
}

export function usePlanFee(): UsePlanFeeValue {
  const planFeeUsd = useStore(planFeeStore, (s) => s.planFeeUsd)
  const { setPlanFee } = planFeeStore.getState()
  return { planFeeUsd, setPlanFee }
}
