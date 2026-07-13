import { describe, it, expect } from 'vitest'
import { buildDayPoints, type DayGroupRow } from '@main/usage/dashboard'

function row(overrides: Partial<DayGroupRow>): DayGroupRow {
  return {
    day: '2026-07-13',
    model: 'claude-opus-4-8',
    serviceTier: 'standard',
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    ...overrides
  }
}

describe('buildDayPoints', () => {
  it('sums tokens and prices Notional Cost per day, sorted ascending', () => {
    const points = buildDayPoints([
      row({ day: '2026-07-13', inputTokens: 1_000_000 }), // opus input → $15
      row({ day: '2026-07-12', outputTokens: 1_000_000 }) // opus output → $75
    ])
    expect(points).toEqual([
      { day: '2026-07-12', tokens: 1_000_000, costUsd: 75 },
      { day: '2026-07-13', tokens: 1_000_000, costUsd: 15 }
    ])
  })

  it('merges multiple model groups within the same day', () => {
    const [point] = buildDayPoints([
      row({ day: '2026-07-13', model: 'claude-haiku-4-5', inputTokens: 1_000_000 }), // $1
      row({ day: '2026-07-13', model: 'claude-sonnet-4-6', outputTokens: 1_000_000 }) // $15
    ])
    expect(point!.tokens).toBe(2_000_000)
    expect(point!.costUsd).toBeCloseTo(16, 5)
  })

  it('returns an empty series for no rows', () => {
    expect(buildDayPoints([])).toEqual([])
  })
})
