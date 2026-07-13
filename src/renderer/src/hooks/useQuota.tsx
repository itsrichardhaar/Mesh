import { useEffect, type ReactNode } from 'react'
import { useStore } from 'zustand'
import type { QuotaSnapshot } from '@shared/types'
import { createQuotaStore } from '../state/quota'

/**
 * The App's quota store instance (v7 / Slice 51). `window.api` is
 * referenced lazily inside the deps closure, so importing this module
 * never touches the preload bridge.
 */
export const quotaStore = createQuotaStore({
  api: () => window.api.quota
})

/** How often the chip re-fetches while the window stays open. Main caches, so this is cheap. */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000

interface UseQuotaValue {
  enabled: boolean
  snapshot: QuotaSnapshot | null
  setEnabled: (value: boolean) => Promise<void>
  refresh: () => Promise<void>
}

/**
 * Event bridge for Quota. Loads the opt-in flag + first snapshot on
 * mount, then refreshes on window focus and on a slow interval. No IPC
 * push channel exists — Quota is strictly pull-based (main owns the
 * ~5-min cache).
 */
export function QuotaProvider({ children }: { children: ReactNode }): JSX.Element {
  useEffect(() => {
    const state = quotaStore.getState()
    void state.loadEnabled().then(() => quotaStore.getState().refresh())

    const onFocus = (): void => {
      void quotaStore.getState().refresh()
    }
    window.addEventListener('focus', onFocus)
    const interval = window.setInterval(() => {
      void quotaStore.getState().refresh()
    }, REFRESH_INTERVAL_MS)

    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(interval)
    }
  }, [])

  return <>{children}</>
}

export function useQuota(): UseQuotaValue {
  const enabled = useStore(quotaStore, (s) => s.enabled)
  const snapshot = useStore(quotaStore, (s) => s.snapshot)
  const { setEnabled, refresh } = quotaStore.getState()
  return { enabled, snapshot, setEnabled, refresh }
}
