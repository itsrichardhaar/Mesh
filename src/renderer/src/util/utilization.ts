import type { UsageDayPoint } from '@shared/types'

/**
 * Subscription Utilization (v8 / Slice 60) — the current calendar month's
 * Notional Cost against a flat monthly plan fee. Answers "is the
 * subscription paying off?" without ever implying money was spent: the
 * numerator is notional (API-rate value), the fee is a flat constant the
 * user stated and is never decremented (ADR-0010).
 */
export interface Utilization {
  /** This calendar month's Notional Cost (USD, at API rates). */
  costUsd: number
  /** The user's flat monthly plan fee (USD). */
  feeUsd: number
  /** costUsd / feeUsd as a rounded percentage (can exceed 100). */
  percent: number
}

/**
 * Fold the day series to the current calendar month's Notional Cost and
 * compare it to the plan fee. Returns `null` when no positive fee is set
 * (the gauge hides). Pure (takes `now`); month is UTC, matching the day
 * keys.
 */
export function subscriptionUtilization(
  days: readonly UsageDayPoint[],
  feeUsd: number | null,
  now: number
): Utilization | null {
  if (feeUsd === null || !(feeUsd > 0)) return null
  const month = new Date(now).toISOString().slice(0, 7) // YYYY-MM (UTC)
  let costUsd = 0
  for (const d of days) {
    if (d.day.slice(0, 7) === month) costUsd += d.costUsd
  }
  return { costUsd, feeUsd, percent: Math.round((costUsd / feeUsd) * 100) }
}
