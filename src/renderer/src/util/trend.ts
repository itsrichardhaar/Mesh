import type { UsageDayPoint } from '@shared/types'

export type Granularity = 'day' | 'week' | 'month'
export type Range = '30d' | '90d' | 'all'

export interface TrendPoint {
  /** Bucket key/label, e.g. `2026-07-13` (day/week start) or `2026-07` (month). */
  label: string
  tokens: number
  costUsd: number
}

const RANGE_DAYS: Record<Exclude<Range, 'all'>, number> = { '30d': 30, '90d': 90 }

/** Filter the daily series to those within `range` of `now`. Pure. */
export function filterByRange(days: readonly UsageDayPoint[], range: Range, now: number): UsageDayPoint[] {
  if (range === 'all') return [...days]
  const cutoff = new Date(now - RANGE_DAYS[range] * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return days.filter((d) => d.day >= cutoff)
}

/** The bucket key a given `YYYY-MM-DD` falls into, per granularity. */
function bucketKey(day: string, granularity: Granularity): string {
  if (granularity === 'day') return day
  if (granularity === 'month') return day.slice(0, 7)
  // Week: the Monday (UTC) of that day's week.
  const date = new Date(`${day}T00:00:00Z`)
  const dow = date.getUTCDay() // 0=Sun..6=Sat
  const backToMonday = (dow + 6) % 7
  date.setUTCDate(date.getUTCDate() - backToMonday)
  return date.toISOString().slice(0, 10)
}

/**
 * Bucket a per-day series into day/week/month totals within a range.
 * Tokens and cost are both additive across days, so roll-ups are plain
 * sums — no pricing needed here. Pure (takes `now` for range). Buckets
 * come out ascending by label.
 */
export function bucketTrend(
  days: readonly UsageDayPoint[],
  granularity: Granularity,
  range: Range,
  now: number
): TrendPoint[] {
  const buckets = new Map<string, TrendPoint>()
  for (const day of filterByRange(days, range, now)) {
    const key = bucketKey(day.day, granularity)
    const existing = buckets.get(key)
    if (existing) {
      existing.tokens += day.tokens
      existing.costUsd += day.costUsd
    } else {
      buckets.set(key, { label: key, tokens: day.tokens, costUsd: day.costUsd })
    }
  }
  return [...buckets.values()].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
}
