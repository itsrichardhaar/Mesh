import type { QuotaSnapshot, QuotaWindow } from '@shared/types'

/**
 * Map the OAuth usage payload's window keys to Mesh's normalized
 * `QuotaWindow` shape. Mirrors `token-usage-analytics`'s parser
 * (its `claude_usage.parse_oauth_usage`) — the reference spec for the
 * endpoint's shape.
 */
const WINDOW_DEFS = [
  { key: 'five_hour', kind: 'five_hour', label: '5-hour window' },
  { key: 'seven_day', kind: 'seven_day', label: 'Weekly window' }
] as const

/**
 * Pure transform of the `GET /api/oauth/usage` payload into a
 * `QuotaSnapshot`. No network, no clock, no Electron — the whole point
 * is that this is unit-testable against fixtures. Returns `null` only
 * when the payload carries neither primary window as an object (missing
 * or malformed), so callers hide the surface rather than render an empty
 * chip.
 *
 * A present window with a `null`/absent `resets_at` is an *idle* window
 * (nothing consumed in the current period, so the endpoint reports no
 * countdown). It is KEPT at its percent (0 by default) with
 * `resetsAt: null` — dropping it made the 5-hour bar vanish on app open
 * whenever the last 5 hours were quiet.
 *
 * `fetchedAt` is passed in (the caller stamps it from its injected
 * clock) to keep this function free of `Date.now()`.
 */
export function parseOauthUsage(payload: unknown, fetchedAt: string): QuotaSnapshot | null {
  if (typeof payload !== 'object' || payload === null) return null
  const data = payload as Record<string, unknown>

  const windows: QuotaWindow[] = []
  for (const def of WINDOW_DEFS) {
    const raw = data[def.key]
    if (typeof raw !== 'object' || raw === null) continue
    const win = raw as Record<string, unknown>

    const rawReset = win['resets_at']
    const resetsAt = typeof rawReset === 'string' && rawReset.length > 0 ? rawReset : null

    const util = win['utilization']
    const percentUsed = typeof util === 'number' && Number.isFinite(util) ? util : 0

    windows.push({ kind: def.kind, label: def.label, percentUsed, resetsAt })
  }

  if (windows.length === 0) return null
  return { provider: 'claude', windows, fetchedAt }
}
