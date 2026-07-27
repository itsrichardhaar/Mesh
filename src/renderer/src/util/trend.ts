import type { UsageDayPoint } from '@shared/types'

export type Granularity = 'day' | 'week' | 'month'

export interface TrendPoint {
  /** Bucket key/label, e.g. `2026-07-13` (day/week start) or `2026-07` (month). */
  label: string
  tokens: number
  costUsd: number
}

/** Token Composition (v8 / Slice 58) — the four token-class totals. */
export interface TokenComposition {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Sum of the four classes (0 when the series is empty). */
  total: number
}

/**
 * Fold the per-day series into its four token-class totals. Additive
 * across days, so a plain sum — no pricing. Always a token split (never
 * Notional Cost); cache-read is nearly free, so a cost-weighted split
 * would mislead. Pure. The series is already scoped to the active Usage
 * Filter in main (v10 / ADR-0013), so this folds all of it.
 */
export function tokenComposition(days: readonly UsageDayPoint[]): TokenComposition {
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  for (const day of days) {
    inputTokens += day.inputTokens
    outputTokens += day.outputTokens
    cacheReadTokens += day.cacheReadTokens
    cacheWriteTokens += day.cacheWriteTokens
  }
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    total: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
  }
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
 * Bucket a per-day series into day/week/month totals. Tokens and cost are
 * both additive across days, so roll-ups are plain sums — no pricing
 * needed here. Pure. The series is already scoped to the active Usage
 * Filter in main (v10 / ADR-0013). Buckets come out ascending by label.
 */
export function bucketTrend(days: readonly UsageDayPoint[], granularity: Granularity): TrendPoint[] {
  const buckets = new Map<string, TrendPoint>()
  for (const day of days) {
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
