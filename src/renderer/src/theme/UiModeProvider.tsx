import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { UiModePreference } from '@shared/types'
import { isUiModePreference } from '@shared/types'

interface UiModeContextValue {
  /** The user's stored UI Mode preference. */
  mode: UiModePreference
  /** Whether the persisted preference has been loaded yet. */
  ready: boolean
  setMode(next: UiModePreference): void
}

const UiModeContext = createContext<UiModeContextValue | null>(null)

const STORAGE_KEY = 'ui.mode'

export function UiModeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [mode, setModeState] = useState<UiModePreference>('sans')
  const [ready, setReady] = useState(false)

  // Avoid persisting during the initial hydration pass — we'd otherwise
  // overwrite the same value we just read.
  const hydratedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    window.api.settings
      .get(STORAGE_KEY)
      .then((value) => {
        if (cancelled) return
        const next: UiModePreference = isUiModePreference(value) ? value : 'sans'
        setModeState(next)
        hydratedRef.current = true
        setReady(true)
      })
      .catch(() => {
        if (cancelled) return
        hydratedRef.current = true
        setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Mirror to `<html data-ui-mode>` so token overrides take effect
  // across the whole document.
  useEffect(() => {
    document.documentElement.setAttribute('data-ui-mode', mode)
  }, [mode])

  // Persist after hydration so we don't echo back the value we just read.
  useEffect(() => {
    if (!hydratedRef.current) return
    void window.api.settings.set(STORAGE_KEY, mode)
  }, [mode])

  const setMode = useCallback((next: UiModePreference) => {
    setModeState(next)
  }, [])

  const value = useMemo<UiModeContextValue>(
    () => ({ mode, ready, setMode }),
    [mode, ready, setMode]
  )

  return <UiModeContext.Provider value={value}>{children}</UiModeContext.Provider>
}

export function useUiMode(): UiModeContextValue {
  const ctx = useContext(UiModeContext)
  if (!ctx) throw new Error('useUiMode must be used inside UiModeProvider')
  return ctx
}
