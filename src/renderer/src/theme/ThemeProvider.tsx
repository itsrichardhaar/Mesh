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
import type { ThemePreference } from '@shared/types'
import { isThemePreference } from '@shared/types'

interface ThemeContextValue {
  /** The user's stored preference — `system` follows the OS, others are explicit. */
  preference: ThemePreference
  /** The palette currently applied to the DOM (`system` resolved). */
  effective: 'light' | 'dark'
  /** Whether the persisted preference has been loaded yet. */
  ready: boolean
  setPreference(next: ThemePreference): void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'theme'
const DARK_MEDIA = '(prefers-color-scheme: dark)'

function systemEffective(): 'light' | 'dark' {
  return typeof window !== 'undefined' && window.matchMedia(DARK_MEDIA).matches
    ? 'dark'
    : 'light'
}

function effectiveFor(pref: ThemePreference): 'light' | 'dark' {
  return pref === 'system' ? systemEffective() : pref
}

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [preference, setPreferenceState] = useState<ThemePreference>('system')
  const [effective, setEffective] = useState<'light' | 'dark'>(() => systemEffective())
  const [ready, setReady] = useState(false)

  // Avoid persisting (and re-notifying main) during the initial hydration
  // pass — we'd otherwise overwrite the same value we just read.
  const hydratedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    window.api.settings
      .get(STORAGE_KEY)
      .then((value) => {
        if (cancelled) return
        const next: ThemePreference = isThemePreference(value) ? value : 'system'
        setPreferenceState(next)
        setEffective(effectiveFor(next))
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

  // Live OS-theme listener, only while in `system` mode.
  useEffect(() => {
    if (preference !== 'system') return
    const mql = window.matchMedia(DARK_MEDIA)
    const handler = (e: MediaQueryListEvent): void => {
      setEffective(e.matches ? 'dark' : 'light')
    }
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [preference])

  // Mirror the effective palette to `<html data-theme>` so token
  // overrides take effect across the whole document.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', effective)
  }, [effective])

  // Persist + native-theme handoff. Runs only after hydration so we
  // don't echo back the value we just read on mount.
  useEffect(() => {
    if (!hydratedRef.current) return
    void window.api.settings.set(STORAGE_KEY, preference)
    window.api.theme.setSource(preference)
  }, [preference])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    setEffective(effectiveFor(next))
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, effective, ready, setPreference }),
    [preference, effective, ready, setPreference]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
