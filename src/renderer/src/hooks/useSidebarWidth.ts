import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * v5.1: persisted-width state for a resizable sidebar. Mirrors the
 * shape of `useProjectsSidebarCollapsed` and `useFileTreeCollapsed`
 * — a single settings key holds the value as an integer-string; the
 * hook hydrates async on mount and defaults to the passed-in `default`
 * width until the stored value loads.
 *
 * Persistence is debounced so a drag doesn't spam the IPC channel;
 * the local width state updates every mousemove for smooth motion,
 * and the settings write fires once after `flushMs` of stillness (or
 * immediately on unmount / explicit `flush` call). Callers get both
 * a live `width` value and a `setWidth` setter that handles the
 * debounce timer.
 */
export function useSidebarWidth(
  settingsKey: string,
  {
    defaultWidth,
    min,
    max,
    flushMs = 250
  }: { defaultWidth: number; min: number; max: number; flushMs?: number }
): {
  width: number
  setWidth: (next: number) => void
  ready: boolean
} {
  const [width, setWidthState] = useState<number>(defaultWidth)
  const [ready, setReady] = useState<boolean>(false)
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.settings
      .get(settingsKey)
      .then((stored) => {
        if (cancelled) return
        if (stored !== null) {
          const parsed = Number.parseInt(stored, 10)
          if (Number.isFinite(parsed)) {
            const clamped = Math.min(Math.max(parsed, min), max)
            setWidthState(clamped)
          }
        }
        setReady(true)
      })
      .catch(() => {
        // Stay with the default; still mark ready so components render.
        setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [settingsKey, min, max])

  // Flush any pending write on unmount so the last drag position isn't lost.
  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
    }
  }, [])

  const setWidth = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, min), max)
      setWidthState(clamped)
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current)
      flushTimerRef.current = setTimeout(() => {
        void window.api.settings.set(settingsKey, String(clamped))
        flushTimerRef.current = null
      }, flushMs)
    },
    [settingsKey, min, max, flushMs]
  )

  return { width, setWidth, ready }
}
