import type { UsageDayPoint } from '@shared/types'
import { bucketTrend, tokenComposition } from '@renderer/util/trend'

/** A day point whose four token classes sum to `tokens` (10/20/60/10 shape). */
function day(d: string, tokens: number, costUsd: number): UsageDayPoint {
  return {
    day: d,
    tokens,
    costUsd,
    inputTokens: tokens * 0.1,
    outputTokens: tokens * 0.2,
    cacheReadTokens: tokens * 0.6,
    cacheWriteTokens: tokens * 0.1
  }
}

// The series is already scoped to the active Usage Filter in main (v10 /
// ADR-0013); these pure helpers fold whatever they're given.
const DAYS: UsageDayPoint[] = [
  day('2026-05-01', 100, 1),
  day('2026-07-10', 200, 2),
  day('2026-07-13', 300, 3) // same month as above
]

function total(points: { tokens: number; costUsd: number }[]): { tokens: number; costUsd: number } {
  return points.reduce(
    (acc, p) => ({ tokens: acc.tokens + p.tokens, costUsd: acc.costUsd + p.costUsd }),
    { tokens: 0, costUsd: 0 }
  )
}

describe('bucketTrend', () => {
  it('day granularity yields one bucket per day, labels ascending', () => {
    const points = bucketTrend(DAYS, 'day')
    expect(points.map((p) => p.label)).toEqual(['2026-05-01', '2026-07-10', '2026-07-13'])
  })

  it('month granularity merges same-month days and conserves totals', () => {
    const points = bucketTrend(DAYS, 'month')
    expect(points.map((p) => p.label)).toEqual(['2026-05', '2026-07'])
    const july = points.find((p) => p.label === '2026-07')!
    expect(july.tokens).toBe(500) // 200 + 300
    expect(july.costUsd).toBe(5)
    expect(total(points)).toEqual({ tokens: 600, costUsd: 6 }) // conservation
  })

  it('folds every provided day (main already applied the timeframe)', () => {
    expect(bucketTrend(DAYS, 'day')).toHaveLength(3)
  })
})

describe('tokenComposition', () => {
  it('folds the four token classes over the series, summing to total', () => {
    const all = tokenComposition(DAYS)
    expect(all).toEqual({
      inputTokens: 60, // 10% of 600
      outputTokens: 120, // 20%
      cacheReadTokens: 360, // 60%
      cacheWriteTokens: 60, // 10%
      total: 600
    })
    expect(all.inputTokens + all.outputTokens + all.cacheReadTokens + all.cacheWriteTokens).toBe(
      all.total
    )
  })

  it('returns zeroed totals for an empty series', () => {
    expect(tokenComposition([])).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      total: 0
    })
  })
})
