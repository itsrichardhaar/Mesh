import { useEffect, useRef, useState } from 'react'
import type { QuotaWindow } from '@shared/types'
import { useQuota } from '../hooks/useQuota'

/**
 * Format the countdown to a Quota window's reset, e.g. "resets in 2h 41m".
 * Pure (takes `now` so it's testable without the wall clock). A `null` or
 * empty `resetsAt` means the window is idle with no countdown running, so
 * we show nothing (`''`) and the caller hides the reset line. A present
 * but past-due or unparseable timestamp collapses to "resets soon".
 */
export function formatReset(resetsAt: string | null, now: number): string {
  if (!resetsAt) return ''
  const target = Date.parse(resetsAt)
  if (Number.isNaN(target)) return 'resets soon'
  const ms = target - now
  if (ms <= 0) return 'resets soon'

  const totalMinutes = Math.floor(ms / 60_000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return `resets in ${days}d ${hours}h`
  if (hours > 0) return `resets in ${hours}h ${minutes}m`
  return `resets in ${minutes}m`
}

/** Round + clamp a raw utilization percent to a whole 0–100. */
function usedPercent(win: QuotaWindow): number {
  return Math.max(0, Math.min(100, Math.round(win.percentUsed)))
}

/**
 * The at-a-glance inline bar for one window — the dropdown's click target
 * (v10 / Slice 73). Decorative (`aria-hidden`): the toggle button carries
 * the accessible summary, and the dropdown carries the full detail. State
 * still reads without colour: the short label + fill length + numeric %.
 */
function QuotaGauge({ window: win }: { window: QuotaWindow }): JSX.Element {
  const pct = usedPercent(win)
  const short = win.kind === 'five_hour' ? '5h' : '7d'
  return (
    <span className="quota-gauge" aria-hidden="true">
      <span className="quota-gauge-label">{short}</span>
      <span className="quota-gauge-track">
        <span className="quota-gauge-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="quota-gauge-pct">{pct}%</span>
    </span>
  )
}

/**
 * One window's full row inside the dropdown — label · resets-in · a fill
 * bar · % used · % remaining. Remaining is `max(0, 100 − used)` off the
 * rounded used, so the two read as a clean split. Never hue alone: the
 * accessible label spells out both percentages and the reset (Slice 73).
 */
function QuotaWindowRow({ window: win, now }: { window: QuotaWindow; now: number }): JSX.Element {
  const used = usedPercent(win)
  const remaining = Math.max(0, 100 - used)
  const reset = formatReset(win.resetsAt, now)
  const summary = `${win.label}: ${used} percent used, ${remaining} percent remaining`
  return (
    <div
      className="quota-window"
      role="group"
      aria-label={reset ? `${summary}, ${reset}` : summary}
    >
      <div className="quota-window-head">
        <span className="quota-window-label">{win.label}</span>
        {reset && <span className="quota-window-reset">{reset}</span>}
      </div>
      <span className="quota-window-track" aria-hidden="true">
        <span className="quota-window-fill" style={{ width: `${used}%` }} />
      </span>
      <div className="quota-window-foot" aria-hidden="true">
        <span className="quota-window-used">{used}% used</span>
        <span className="quota-window-remaining">{remaining}% left</span>
      </div>
    </div>
  )
}

/**
 * Persistent top-bar chip showing account-global Claude Quota (v7 / Slice
 * 51; clickable in v10 / Slice 73). Renders nothing when the feature is
 * disabled, has no credential, or the fetch failed (`snapshot === null`) —
 * the surface hides cleanly rather than showing an error.
 *
 * The two inline bars are the click target: clicking either opens ONE
 * shared dropdown (notifications-dropdown pattern — anchored under the
 * chip, dismissed on outside-click / Escape) detailing both windows.
 */
export function QuotaChip(): JSX.Element | null {
  const { enabled, snapshot } = useQuota()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click + Esc (same pattern as NotificationsBell).
  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!enabled || !snapshot || snapshot.windows.length === 0) return null

  const now = Date.now()
  const summary = snapshot.windows
    .map((w) => `${w.label} ${usedPercent(w)}% used`)
    .join(', ')

  return (
    <div className="quota-chip" ref={containerRef}>
      <button
        type="button"
        className={`quota-chip-toggle${open ? ' quota-chip-toggle-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={open ? 'Close Claude Code Quota details' : `Claude Code Quota: ${summary}. Open details`}
      >
        {snapshot.windows.map((win) => (
          <QuotaGauge key={win.kind} window={win} />
        ))}
      </button>
      {open && (
        <div className="quota-dropdown" role="dialog" aria-label="Claude Code Quota">
          <header className="quota-dropdown-header">
            <span className="quota-dropdown-title">Claude Code Quota</span>
            <span className="quota-dropdown-sub">live · subscription</span>
          </header>
          <div className="quota-dropdown-body">
            {snapshot.windows.map((win) => (
              <QuotaWindowRow key={win.kind} window={win} now={now} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
