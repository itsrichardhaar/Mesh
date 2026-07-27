import { describe, it, expect } from 'vitest'
import { resolveTimeframe } from '@main/usage/timeframe'

// A fixed "now" mid-month so the boundary math is deterministic.
const NOW = new Date('2026-07-15T18:30:00Z')

describe('resolveTimeframe', () => {
  it('all → no bounds', () => {
    expect(resolveTimeframe('all', NOW)).toEqual({ start: null, end: null })
  })

  it('month → first day of the UTC month at 00:00:00Z', () => {
    expect(resolveTimeframe('month', NOW)).toEqual({
      start: '2026-07-01T00:00:00.000Z',
      end: null
    })
  })

  it('7d → trailing 7 days inclusive of today (today − 6 at UTC midnight)', () => {
    expect(resolveTimeframe('7d', NOW)).toEqual({
      start: '2026-07-09T00:00:00.000Z',
      end: null
    })
  })

  it('30d → today − 29 at UTC midnight, crossing the month boundary', () => {
    // 2026-07-15 − 29 days = 2026-06-16.
    expect(resolveTimeframe('30d', NOW)).toEqual({
      start: '2026-06-16T00:00:00.000Z',
      end: null
    })
  })

  it('90d → today − 89 at UTC midnight', () => {
    // 2026-07-15 − 89 days = 2026-04-17.
    expect(resolveTimeframe('90d', NOW)).toEqual({
      start: '2026-04-17T00:00:00.000Z',
      end: null
    })
  })

  it('month on the first of the month → that day 00:00:00Z (inclusive)', () => {
    expect(resolveTimeframe('month', new Date('2026-07-01T09:00:00Z')).start).toBe(
      '2026-07-01T00:00:00.000Z'
    )
  })
})
