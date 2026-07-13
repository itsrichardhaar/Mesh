import type { UsageDayPoint } from '@shared/types'
import { notionalCost, type TokenGroup } from './cost'

export type DayGroupRow = TokenGroup & { day: string }

/**
 * Collapse per-(day, model, tier) token rows into a per-day series with
 * tokens summed and Notional Cost priced within each day (so each day's
 * cost respects its own model mix + service tiers). The renderer buckets
 * this daily series into day/week/month and filters by range — cost is
 * additive across days, so those roll-ups need no pricing. Pure.
 */
export function buildDayPoints(rows: readonly DayGroupRow[]): UsageDayPoint[] {
  const byDay = new Map<string, TokenGroup[]>()
  for (const row of rows) {
    const groups = byDay.get(row.day)
    if (groups) groups.push(row)
    else byDay.set(row.day, [row])
  }

  const points: UsageDayPoint[] = []
  for (const [day, groups] of byDay) {
    const tokens = groups.reduce(
      (sum, g) => sum + g.inputTokens + g.cacheReadTokens + g.cacheWriteTokens + g.outputTokens,
      0
    )
    points.push({ day, tokens, costUsd: notionalCost(groups).totalUsd })
  }
  points.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  return points
}
