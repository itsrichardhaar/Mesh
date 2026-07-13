import type { QuotaWindow } from '@shared/types'
import { useQuota } from '../hooks/useQuota'

/**
 * Format the countdown to a Quota window's reset, e.g. "resets in 2h 41m".
 * Pure (takes `now` so it's testable without the wall clock). Past-due or
 * unparseable timestamps collapse to "resets soon".
 */
export function formatReset(resetsAt: string, now: number): string {
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

function QuotaGauge({ window: win, now }: { window: QuotaWindow; now: number }): JSX.Element {
  const pct = Math.max(0, Math.min(100, Math.round(win.percentUsed)))
  const short = win.kind === 'five_hour' ? '5h' : '7d'
  const reset = formatReset(win.resetsAt, now)

  return (
    <div
      className="quota-gauge"
      role="group"
      aria-label={`${win.label}: ${pct} percent used, ${reset}`}
      title={`${win.label} · ${pct}% used · ${reset}`}
    >
      {/* State is carried by the number + fill length + label — never hue alone
          (reduced-color-vision constraint; the fill has no per-level color). */}
      <span className="quota-gauge-label" aria-hidden="true">
        {short}
      </span>
      <span className="quota-gauge-track" aria-hidden="true">
        <span className="quota-gauge-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="quota-gauge-pct" aria-hidden="true">
        {pct}%
      </span>
    </div>
  )
}

/**
 * Persistent top-bar chip showing account-global Claude Quota (v7 /
 * Slice 51). Renders nothing when the feature is disabled, has no
 * credential, or the fetch failed (`snapshot === null`) — the surface
 * hides cleanly rather than showing an error.
 */
export function QuotaChip(): JSX.Element | null {
  const { enabled, snapshot } = useQuota()
  if (!enabled || !snapshot || snapshot.windows.length === 0) return null

  const now = Date.now()
  return (
    <div className="quota-chip" aria-label="Claude subscription quota">
      {snapshot.windows.map((win) => (
        <QuotaGauge key={win.kind} window={win} now={now} />
      ))}
    </div>
  )
}
