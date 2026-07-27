import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@main/db/migrations'
import { insertUsageEvents } from '@main/usage/repository'
import { metricCards } from '@main/usage/metrics'
import type { UsageEvent } from '@shared/types'

// US-Pacific-daylight: UTC→local is −7h. `now` is a fixed UTC instant so
// every window ("today"/"7-day"/"month") is deterministic regardless of
// when the suite runs.
const PACIFIC_OFFSET = -420
const NOW = new Date('2026-07-27T20:00:00.000Z') // local 2026-07-27 13:00

let seq = 0
function ev(timestamp: string, overrides: Partial<UsageEvent> = {}): UsageEvent {
  seq += 1
  return {
    eventId: `evt-${seq}`,
    encodedPath: '-proj',
    sessionId: 's1',
    timestamp,
    model: 'claude-opus-4-8',
    inputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    serviceTier: 'standard',
    gitBranch: 'main',
    cwd: '/proj',
    sourceFile: '/proj/s1.jsonl',
    sourceLine: seq,
    ...overrides
  }
}

describe('metricCards', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    seq = 0
  })
  afterEach(() => db.close())

  it('buckets a post-UTC-midnight event to the correct LOCAL day', () => {
    // 02:30Z on the 27th is 19:30 on the 26th in Pacific — it belongs to
    // "yesterday", not "today". Today (the 27th local) has one event.
    insertUsageEvents(db, [
      ev('2026-07-27T02:30:00.000Z', { inputTokens: 500 }), // local 07-26 19:30
      ev('2026-07-27T20:30:00.000Z', { inputTokens: 300 }) // local 07-27 13:30
    ])
    const cards = metricCards(db, NOW, PACIFIC_OFFSET, null)
    expect(cards.today.tokens).toBe(300)
    // Both days fall inside the trailing-7 window → 800 tokens, 2 active days.
    expect(cards.sevenDay.tokens).toBe(800)
    expect(cards.sevenDay.activeDays).toBe(2)
  })

  it('counts distinct Sessions active today', () => {
    insertUsageEvents(db, [
      ev('2026-07-27T20:00:00.000Z', { sessionId: 'a', inputTokens: 10 }),
      ev('2026-07-27T21:00:00.000Z', { sessionId: 'b', inputTokens: 10 }),
      ev('2026-07-27T22:00:00.000Z', { sessionId: 'a', inputTokens: 10 }) // same session again
    ])
    expect(metricCards(db, NOW, PACIFIC_OFFSET, null).today.sessions).toBe(2)
  })

  it('averages This Month over ACTIVE days, not calendar days', () => {
    // Two active local days this month (the 10th and the 27th), 900 tokens
    // total → avg 450 per active day even though ~27 calendar days elapsed.
    insertUsageEvents(db, [
      ev('2026-07-10T18:00:00.000Z', { inputTokens: 600 }), // local 07-10
      ev('2026-07-27T18:00:00.000Z', { inputTokens: 300 }) // local 07-27
    ])
    const cards = metricCards(db, NOW, PACIFIC_OFFSET, null)
    expect(cards.month.tokens).toBe(900)
    expect(cards.month.activeDays).toBe(2)
    expect(cards.month.avgPerActiveDay).toBe(450)
  })

  it('excludes prior-month events from This Month (local boundary)', () => {
    // 2026-07-01T05:00Z is local 2026-06-30 22:00 — still June, excluded.
    insertUsageEvents(db, [
      ev('2026-07-01T05:00:00.000Z', { inputTokens: 999 }), // local 06-30
      ev('2026-07-15T18:00:00.000Z', { inputTokens: 100 }) // local 07-15
    ])
    expect(metricCards(db, NOW, PACIFIC_OFFSET, 0).month.tokens).toBe(100)
  })

  it('is all-zero on an empty cache and yields no divide-by-zero', () => {
    const cards = metricCards(db, NOW, PACIFIC_OFFSET, 20)
    expect(cards.today).toEqual({ tokens: 0, sessions: 0 })
    expect(cards.sevenDay).toEqual({ tokens: 0, activeDays: 0 })
    expect(cards.month.avgPerActiveDay).toBe(0)
    // Fee set but no cost → 0× (not null; the card renders a real multiple).
    expect(cards.subscription).toEqual({ notionalUsd: 0, feeUsd: 20, multiple: 0 })
  })

  it('returns null Subscription when no positive fee is set', () => {
    insertUsageEvents(db, [ev('2026-07-27T18:00:00.000Z')])
    expect(metricCards(db, NOW, PACIFIC_OFFSET, null).subscription).toBeNull()
    expect(metricCards(db, NOW, PACIFIC_OFFSET, 0).subscription).toBeNull()
    expect(metricCards(db, NOW, PACIFIC_OFFSET, -5).subscription).toBeNull()
  })

  it('computes the Subscription multiple = month notional ÷ fee', () => {
    // 1M output tokens of opus this month → a known notional; assert the
    // multiple is notional/fee and the numerator matches notionalUsd.
    insertUsageEvents(db, [
      ev('2026-07-20T18:00:00.000Z', { inputTokens: 0, outputTokens: 1_000_000 })
    ])
    const cards = metricCards(db, NOW, PACIFIC_OFFSET, 10)
    expect(cards.subscription).not.toBeNull()
    const sub = cards.subscription!
    expect(sub.feeUsd).toBe(10)
    expect(sub.notionalUsd).toBeGreaterThan(0)
    expect(sub.multiple).toBeCloseTo(sub.notionalUsd / 10, 10)
  })
})
