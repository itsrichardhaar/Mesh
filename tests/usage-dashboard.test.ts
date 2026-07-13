import { describe, it, expect } from 'vitest'
import {
  buildDayPoints,
  buildProjectRows,
  buildSessionRows,
  buildTurns,
  type DayGroupRow
} from '@main/usage/dashboard'
import type { TokenGroup } from '@main/usage/cost'

function tg(overrides: Partial<TokenGroup> = {}): TokenGroup {
  return {
    model: 'claude-opus-4-8',
    serviceTier: 'standard',
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    ...overrides
  }
}

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

describe('buildProjectRows', () => {
  it('ranks projects by tokens and prices each project', () => {
    const rows = buildProjectRows(
      [
        { ...tg({ inputTokens: 2_000_000 }), encodedPath: '-a' }, // opus → $30
        { ...tg({ model: 'claude-haiku-4-5', inputTokens: 1_000_000 }), encodedPath: '-b' } // haiku → $1
      ],
      [
        { encodedPath: '-a', sessionCount: 2, tokens: 2_000_000, lastActivity: '2026-07-13T00:00:00Z' },
        { encodedPath: '-b', sessionCount: 1, tokens: 1_000_000, lastActivity: '2026-07-12T00:00:00Z' }
      ]
    )
    expect(rows.map((r) => r.encodedPath)).toEqual(['-a', '-b']) // tokens desc
    expect(rows[0]!.costUsd).toBeCloseTo(30, 5)
    expect(rows[1]!.costUsd).toBeCloseTo(1, 5)
    expect(rows[0]!.sessionCount).toBe(2)
  })
})

describe('buildSessionRows', () => {
  it('returns the top-N sessions by tokens with cost, dominant model, and duration', () => {
    const rows = buildSessionRows(
      [
        { ...tg({ inputTokens: 3_000_000 }), sessionId: 's1' }, // opus dominant
        { ...tg({ model: 'claude-haiku-4-5', inputTokens: 200_000 }), sessionId: 's1' },
        { ...tg({ inputTokens: 1_000_000 }), sessionId: 's2' }
      ],
      [
        {
          sessionId: 's1',
          encodedPath: '-a',
          eventCount: 9,
          tokens: 3_200_000,
          firstActivity: '2026-07-13T00:00:00Z',
          lastActivity: '2026-07-13T01:00:00Z'
        },
        {
          sessionId: 's2',
          encodedPath: '-a',
          eventCount: 3,
          tokens: 1_000_000,
          firstActivity: '2026-07-12T00:00:00Z',
          lastActivity: '2026-07-12T00:00:30Z'
        }
      ],
      1
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.sessionId).toBe('s1')
    expect(rows[0]!.costUsd).toBeCloseTo(45.2, 5) // 3M opus input ($45) + 200K haiku input ($0.20)
    expect(rows[0]!.model).toBe('claude-opus-4-8') // most tokens
    expect(rows[0]!.durationMs).toBe(3_600_000)
  })
})

describe('buildTurns', () => {
  it('maps per-turn rows with summed tokens and per-turn cost', () => {
    const turns = buildTurns([
      { ...tg({ inputTokens: 1_000_000 }), eventId: 'e1', timestamp: '2026-07-13T00:00:00Z' }
    ])
    expect(turns).toEqual([
      { eventId: 'e1', timestamp: '2026-07-13T00:00:00Z', model: 'claude-opus-4-8', tokens: 1_000_000, costUsd: 15 }
    ])
  })
})
