import type Database from 'better-sqlite3'
import type { MetricCards } from '@shared/types'
import { notionalCost } from './cost'
import { rangeActiveDays, rangeTokenGroups, rangeTokensAndSessions } from './repository'

/**
 * Global Metric Cards producer (v10 / Slice 72). Computes Today / 7-Day /
 * This Month on the user's **local calendar day** and month-to-date
 * Subscription Utilization — all unaffected by the Usage Filter (they read
 * all-project, and their windows are local-day, not the filter's UTC
 * range). The rest of the Usage pipeline stays UTC (grill decision #4:
 * keep the boundary); only the cards opt into local time so "today"
 * matches the wall clock.
 *
 * Pure — `now`, `offsetMinutes`, and `feeUsd` are injected (the IPC handler
 * supplies the machine's tz offset and the parsed plan fee). `offsetMinutes`
 * is the minutes to **add to a UTC instant to reach local wall clock**
 * (i.e. `-new Date().getTimezoneOffset()`): US-Pacific-daylight is `-420`.
 */
export function metricCards(
  db: Database.Database,
  now: Date,
  offsetMinutes: number,
  feeUsd: number | null
): MetricCards {
  // A SQLite datetime modifier that maps a stored UTC timestamp to local
  // wall clock, so active-day bucketing lands on the right local day.
  const shift = `${offsetMinutes} minutes`

  const todayStart = localMidnightUtc(now, offsetMinutes, 0)
  // Exclusive upper bound shared by all three windows: the start of the
  // next local day, so "up to end of today" needs no clock arithmetic.
  const endExclusive = localMidnightUtc(now, offsetMinutes, 1)
  const sevenStart = localMidnightUtc(now, offsetMinutes, -6) // trailing 7 days incl. today
  const monthStart = localMonthStartUtc(now, offsetMinutes)

  const today = rangeTokensAndSessions(db, todayStart, endExclusive)
  const seven = rangeTokensAndSessions(db, sevenStart, endExclusive)
  const sevenActive = rangeActiveDays(db, sevenStart, endExclusive, shift)
  const month = rangeTokensAndSessions(db, monthStart, endExclusive)
  const monthActive = rangeActiveDays(db, monthStart, endExclusive, shift)
  const monthCost = notionalCost(rangeTokenGroups(db, monthStart, endExclusive))

  return {
    today: { tokens: today.tokens, sessions: today.sessions },
    sevenDay: { tokens: seven.tokens, activeDays: sevenActive },
    month: {
      tokens: month.tokens,
      activeDays: monthActive,
      // Average over ACTIVE days, never calendar days (grill decision #4).
      avgPerActiveDay: monthActive > 0 ? month.tokens / monthActive : 0
    },
    // Fee gate matches the renderer's `parseFee`: a positive fee, else the
    // card shows a set-your-fee hint. Numerator is notional (API-rate
    // value), fee a flat constant never decremented (ADR-0010).
    subscription:
      feeUsd !== null && feeUsd > 0
        ? { notionalUsd: monthCost.totalUsd, feeUsd, multiple: monthCost.totalUsd / feeUsd }
        : null
  }
}

/**
 * UTC ISO of local midnight for `now`'s local day plus `dayDelta` days.
 * Shift `now` into local wall clock, take that day's midnight as wall-clock
 * fields, then shift back to a real UTC instant.
 */
function localMidnightUtc(now: Date, offsetMinutes: number, dayDelta: number): string {
  const local = new Date(now.getTime() + offsetMinutes * 60_000)
  const wall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayDelta)
  return new Date(wall - offsetMinutes * 60_000).toISOString()
}

/** UTC ISO of the first instant of `now`'s local calendar month. */
function localMonthStartUtc(now: Date, offsetMinutes: number): string {
  const local = new Date(now.getTime() + offsetMinutes * 60_000)
  const wall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1)
  return new Date(wall - offsetMinutes * 60_000).toISOString()
}
