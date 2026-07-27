import type { UsageTimeframe } from '@shared/types'

/**
 * An inclusive lower/upper timestamp bound for a Usage Filter query.
 * `start`/`end` are ISO 8601 strings compared against `usage_events.timestamp`;
 * `null` means "unbounded on that side". v10's Timeframes are all trailing
 * windows ending at "now", so `end` is always null (no future data exists) —
 * the field is kept for a possible future custom range.
 */
export interface UsageDateRange {
  start: string | null
  end: string | null
}

/**
 * Resolve a Timeframe to a date range (ADR-0013). Bounds are computed on
 * **UTC** day boundaries to stay consistent with the UTC-keyed `days[]`
 * pipeline (the local-tz treatment is reserved for the global Metric Cards,
 * Slice 72). Pure — `now` is injected.
 *
 * - `all`   → no bound.
 * - `month` → from the first day of `now`'s UTC month, 00:00:00Z.
 * - `7d`/`30d`/`90d` → trailing N days *inclusive of today*, i.e. from
 *   00:00:00Z of `(today − (N−1))`.
 */
export function resolveTimeframe(timeframe: UsageTimeframe, now: Date): UsageDateRange {
  if (timeframe === 'all') return { start: null, end: null }

  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const d = now.getUTCDate()

  if (timeframe === 'month') {
    return { start: new Date(Date.UTC(y, m, 1)).toISOString(), end: null }
  }

  const days = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : 90
  // Inclusive of today → subtract (N − 1) days from today's UTC midnight.
  return { start: new Date(Date.UTC(y, m, d - (days - 1))).toISOString(), end: null }
}
