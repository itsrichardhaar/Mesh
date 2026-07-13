import type { UsageDayPoint } from '@shared/types'
import { bucketTrend, filterByRange } from '@renderer/util/trend'

const NOW = Date.parse('2026-07-15T00:00:00Z')

const DAYS: UsageDayPoint[] = [
  { day: '2026-05-01', tokens: 100, costUsd: 1 }, // ~75d ago
  { day: '2026-07-10', tokens: 200, costUsd: 2 }, // within 30d
  { day: '2026-07-13', tokens: 300, costUsd: 3 } // within 30d, same month as above
]

function total(points: { tokens: number; costUsd: number }[]): { tokens: number; costUsd: number } {
  return points.reduce(
    (acc, p) => ({ tokens: acc.tokens + p.tokens, costUsd: acc.costUsd + p.costUsd }),
    { tokens: 0, costUsd: 0 }
  )
}

describe('filterByRange', () => {
  it('keeps only days within the window', () => {
    expect(filterByRange(DAYS, '30d', NOW).map((d) => d.day)).toEqual(['2026-07-10', '2026-07-13'])
    expect(filterByRange(DAYS, '90d', NOW).map((d) => d.day)).toEqual([
      '2026-05-01',
      '2026-07-10',
      '2026-07-13'
    ])
    expect(filterByRange(DAYS, 'all', NOW)).toHaveLength(3)
  })
})

describe('bucketTrend', () => {
  it('day granularity yields one bucket per day, labels ascending', () => {
    const points = bucketTrend(DAYS, 'day', 'all', NOW)
    expect(points.map((p) => p.label)).toEqual(['2026-05-01', '2026-07-10', '2026-07-13'])
  })

  it('month granularity merges same-month days and conserves totals', () => {
    const points = bucketTrend(DAYS, 'month', 'all', NOW)
    expect(points.map((p) => p.label)).toEqual(['2026-05', '2026-07'])
    const july = points.find((p) => p.label === '2026-07')!
    expect(july.tokens).toBe(500) // 200 + 300
    expect(july.costUsd).toBe(5)
    expect(total(points)).toEqual({ tokens: 600, costUsd: 6 }) // conservation
  })

  it('respects the range filter', () => {
    const points = bucketTrend(DAYS, 'day', '30d', NOW)
    expect(points.map((p) => p.label)).toEqual(['2026-07-10', '2026-07-13'])
  })
})
