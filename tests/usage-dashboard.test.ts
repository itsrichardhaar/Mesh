import { describe, it, expect } from 'vitest'
import {
  buildDayPoints,
  buildModelRows,
  buildProjectRows,
  buildSessionRows,
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
      {
        day: '2026-07-12',
        tokens: 1_000_000,
        costUsd: 75,
        inputTokens: 0,
        outputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0
      },
      {
        day: '2026-07-13',
        tokens: 1_000_000,
        costUsd: 15,
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0
      }
    ])
  })

  it('splits a day’s tokens by class, summing to the day total', () => {
    const [point] = buildDayPoints([
      row({ day: '2026-07-13', inputTokens: 100, outputTokens: 200 }),
      row({ day: '2026-07-13', cacheReadTokens: 600, cacheWriteTokens: 100 })
    ])
    expect(point!.inputTokens).toBe(100)
    expect(point!.outputTokens).toBe(200)
    expect(point!.cacheReadTokens).toBe(600)
    expect(point!.cacheWriteTokens).toBe(100)
    expect(point!.tokens).toBe(1000) // sum of the four classes
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

describe('buildModelRows', () => {
  it('ranks models by tokens, folds tiers, and prices each model', () => {
    const rows = buildModelRows([
      // opus split across two tiers → tokens summed, both priced as opus
      tg({ inputTokens: 1_000_000 }), // standard → $15
      tg({ serviceTier: 'batch', inputTokens: 1_000_000 }), // batch → half → $7.50
      tg({ model: 'claude-haiku-4-5', inputTokens: 1_000_000 }) // haiku → $1
    ])
    expect(rows.map((r) => r.model)).toEqual(['claude-opus-4-8', 'claude-haiku-4-5']) // tokens desc
    expect(rows[0]!.tokens).toBe(2_000_000)
    expect(rows[0]!.costUsd).toBeCloseTo(22.5, 5)
    expect(rows[1]!.tokens).toBe(1_000_000)
    expect(rows[1]!.costUsd).toBeCloseTo(1, 5)
  })

  it('keeps an unlabeled (null) model as its own row with $0 cost', () => {
    const rows = buildModelRows([tg({ model: null, outputTokens: 500_000 })])
    expect(rows).toEqual([{ model: null, tokens: 500_000, costUsd: 0 }])
  })

  it('returns an empty list for no groups', () => {
    expect(buildModelRows([])).toEqual([])
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

  it('rolls a run into its Parent — one merged row, no ULID rows (Slice D)', () => {
    // -run rolls up into -parent; tokens/sessions summed, cost merged, no -run row.
    const resolve = (e: string): string => (e === '-run' ? '-parent' : e)
    const rows = buildProjectRows(
      [
        { ...tg({ inputTokens: 1_000_000 }), encodedPath: '-parent' }, // opus → $15
        { ...tg({ inputTokens: 1_000_000 }), encodedPath: '-run' } // opus → $15
      ],
      [
        { encodedPath: '-parent', sessionCount: 1, tokens: 1_000_000, lastActivity: '2026-07-13T00:00:00Z' },
        { encodedPath: '-run', sessionCount: 2, tokens: 1_000_000, lastActivity: '2026-07-14T00:00:00Z' }
      ],
      resolve
    )
    expect(rows.map((r) => r.encodedPath)).toEqual(['-parent']) // no ULID/run row
    expect(rows[0]!.tokens).toBe(2_000_000)
    expect(rows[0]!.sessionCount).toBe(3) // 1 + 2 (Session ids globally unique)
    expect(rows[0]!.costUsd).toBeCloseTo(30, 5) // 15 + 15 rolled up
    expect(rows[0]!.lastActivity).toBe('2026-07-14T00:00:00Z') // maxed
  })
})

describe('buildSessionRows', () => {
  it('computes cost, dominant model, and duration per session', () => {
    const rows = buildSessionRows(
      [
        { ...tg({ inputTokens: 3_000_000 }), sessionId: 's1' }, // opus dominant
        { ...tg({ model: 'claude-haiku-4-5', inputTokens: 200_000 }), sessionId: 's1' }
      ],
      [
        {
          sessionId: 's1',
          encodedPath: '-a',
          eventCount: 9,
          tokens: 3_200_000,
          firstActivity: '2026-07-13T00:00:00Z',
          lastActivity: '2026-07-13T01:00:00Z'
        }
      ],
      50
    )
    expect(rows[0]!.costUsd).toBeCloseTo(45.2, 5) // 3M opus input ($45) + 200K haiku input ($0.20)
    expect(rows[0]!.model).toBe('claude-opus-4-8') // most tokens
    expect(rows[0]!.durationMs).toBe(3_600_000)
    expect(rows[0]!.startedAt).toBe('2026-07-13T00:00:00Z') // first-event timestamp
  })

  it('orders most-recent-first by last activity, not by tokens (Slice 71)', () => {
    const meta = [
      // Older but far more tokens.
      { sessionId: 'big-old', encodedPath: '-a', eventCount: 1, tokens: 9_000_000, firstActivity: '2026-07-10T00:00:00Z', lastActivity: '2026-07-10T00:00:00Z' },
      // Newer but tiny.
      { sessionId: 'small-new', encodedPath: '-a', eventCount: 1, tokens: 10, firstActivity: '2026-07-14T00:00:00Z', lastActivity: '2026-07-14T00:00:00Z' }
    ]
    const groups = [
      { ...tg({ inputTokens: 9_000_000 }), sessionId: 'big-old' },
      { ...tg({ inputTokens: 10 }), sessionId: 'small-new' }
    ]
    const rows = buildSessionRows(groups, meta, 50)
    expect(rows.map((r) => r.sessionId)).toEqual(['small-new', 'big-old'])
  })

  it('caps at the backstop limit while ordered by recency', () => {
    const meta = [
      { sessionId: 's-newest', encodedPath: '-a', eventCount: 1, tokens: 1, firstActivity: '2026-07-14T00:00:00Z', lastActivity: '2026-07-14T00:00:00Z' },
      { sessionId: 's-older', encodedPath: '-a', eventCount: 1, tokens: 1, firstActivity: '2026-07-13T00:00:00Z', lastActivity: '2026-07-13T00:00:00Z' }
    ]
    const groups = meta.map((m) => ({ ...tg({ inputTokens: 1 }), sessionId: m.sessionId }))
    const rows = buildSessionRows(groups, meta, 1)
    expect(rows.map((r) => r.sessionId)).toEqual(['s-newest']) // most-recent kept
  })
})
