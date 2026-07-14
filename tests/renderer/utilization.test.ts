import type { UsageDayPoint } from '@shared/types'
import { subscriptionUtilization } from '@renderer/util/utilization'

const NOW = Date.parse('2026-07-14T12:00:00Z')

function d(day: string, costUsd: number): UsageDayPoint {
  return { day, tokens: 0, costUsd, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

describe('subscriptionUtilization', () => {
  it('returns null when no positive fee is set', () => {
    const days = [d('2026-07-01', 10)]
    expect(subscriptionUtilization(days, null, NOW)).toBeNull()
    expect(subscriptionUtilization(days, 0, NOW)).toBeNull()
    expect(subscriptionUtilization(days, -5, NOW)).toBeNull()
  })

  it('sums only the current calendar month and computes percent of fee', () => {
    const days = [
      d('2026-07-05', 6),
      d('2026-07-10', 6),
      d('2026-06-30', 100) // previous month — excluded
    ]
    expect(subscriptionUtilization(days, 20, NOW)).toEqual({ costUsd: 12, feeUsd: 20, percent: 60 })
  })

  it('exceeds 100 percent when the month beats the fee', () => {
    expect(subscriptionUtilization([d('2026-07-05', 25)], 10, NOW)!.percent).toBe(250)
  })

  it('is 0 percent for a month with no cost', () => {
    expect(subscriptionUtilization([d('2026-06-01', 50)], 20, NOW)).toEqual({
      costUsd: 0,
      feeUsd: 20,
      percent: 0
    })
  })
})
