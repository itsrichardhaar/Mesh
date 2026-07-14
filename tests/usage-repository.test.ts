import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@main/db/migrations'
import type { UsageEvent } from '@shared/types'
import {
  getIngestCursor,
  insertUsageEvents,
  projectUsageCounts,
  setIngestCursor,
  sumTokensByDayAndGroup,
  sumTokensByGroup,
  sumTokensByGroupForProject,
  usageEventCount,
  usageSummaryCounts,
  wipeAllUsage
} from '@main/usage/repository'

function makeEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    eventId: 'evt-1',
    encodedPath: '-p',
    sessionId: 's1',
    timestamp: '2026-07-13T12:00:00Z',
    model: 'claude-opus-4-8',
    inputTokens: 1,
    cacheReadTokens: 2,
    cacheWriteTokens: 3,
    outputTokens: 4,
    serviceTier: 'standard',
    gitBranch: 'main',
    cwd: '/p',
    sourceFile: '/p/s1.jsonl',
    sourceLine: 1,
    ...overrides
  }
}

describe('usage repository', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
  })
  afterEach(() => db.close())

  it('inserts events and counts them', () => {
    const inserted = insertUsageEvents(db, [makeEvent({ eventId: 'a' }), makeEvent({ eventId: 'b' })])
    expect(inserted).toBe(2)
    expect(usageEventCount(db)).toBe(2)
  })

  it('is idempotent by event_id — re-inserting the same id adds nothing', () => {
    expect(insertUsageEvents(db, [makeEvent({ eventId: 'x' })])).toBe(1)
    expect(insertUsageEvents(db, [makeEvent({ eventId: 'x', outputTokens: 999 })])).toBe(0)
    expect(usageEventCount(db)).toBe(1)
    const row = db.prepare('SELECT output_tokens FROM usage_events WHERE event_id = ?').get('x') as {
      output_tokens: number
    }
    expect(row.output_tokens).toBe(4) // original kept (INSERT OR IGNORE)
  })

  it('round-trips the ingest cursor and overwrites on update', () => {
    expect(getIngestCursor(db, '/p/s1.jsonl')).toBeNull()
    setIngestCursor(db, '/p/s1.jsonl', { byteOffset: 100, lineCount: 3 }, '2026-07-13T12:00:00Z')
    expect(getIngestCursor(db, '/p/s1.jsonl')).toEqual({ byteOffset: 100, lineCount: 3 })
    setIngestCursor(db, '/p/s1.jsonl', { byteOffset: 250, lineCount: 8 }, '2026-07-13T12:05:00Z')
    expect(getIngestCursor(db, '/p/s1.jsonl')).toEqual({ byteOffset: 250, lineCount: 8 })
  })

  it('sums tokens grouped by (model, service_tier)', () => {
    insertUsageEvents(db, [
      makeEvent({ eventId: 'a', model: 'claude-opus-4-8', serviceTier: 'standard', inputTokens: 100 }),
      makeEvent({ eventId: 'b', model: 'claude-opus-4-8', serviceTier: 'standard', inputTokens: 50 }),
      makeEvent({ eventId: 'c', model: 'claude-haiku-4-5', serviceTier: 'batch', outputTokens: 7 })
    ])
    const groups = sumTokensByGroup(db)
    const opus = groups.find((g) => g.model === 'claude-opus-4-8')
    const haiku = groups.find((g) => g.model === 'claude-haiku-4-5')
    expect(opus).toMatchObject({ serviceTier: 'standard', inputTokens: 150 })
    expect(haiku).toMatchObject({ serviceTier: 'batch', outputTokens: 7 })
  })

  it('summarizes counts (events, distinct sessions, total tokens)', () => {
    // Explicit token fields — makeEvent's non-zero defaults would otherwise leak.
    const zeros = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
    insertUsageEvents(db, [
      makeEvent({ eventId: 'a', sessionId: 's1', ...zeros, inputTokens: 10, outputTokens: 5 }),
      makeEvent({ eventId: 'b', sessionId: 's1', ...zeros, inputTokens: 1 }),
      makeEvent({ eventId: 'c', sessionId: 's2', ...zeros, cacheReadTokens: 2, cacheWriteTokens: 3 })
    ])
    const summary = usageSummaryCounts(db)
    expect(summary.eventCount).toBe(3)
    expect(summary.sessionCount).toBe(2)
    expect(summary.totalTokens).toBe(10 + 5 + 1 + 2 + 3) // 21
  })

  it('groups token sums by day (UTC date) and model/tier', () => {
    insertUsageEvents(db, [
      makeEvent({ eventId: 'a', timestamp: '2026-07-13T09:00:00Z', inputTokens: 4 }),
      makeEvent({ eventId: 'b', timestamp: '2026-07-13T23:00:00Z', inputTokens: 6 }),
      makeEvent({ eventId: 'c', timestamp: '2026-07-14T01:00:00Z', outputTokens: 9 })
    ])
    const rows = sumTokensByDayAndGroup(db)
    const days = rows.map((r) => r.day)
    expect(days).toContain('2026-07-13')
    expect(days).toContain('2026-07-14')
    const jul13 = rows.filter((r) => r.day === '2026-07-13')
    expect(jul13.reduce((s, r) => s + r.inputTokens, 0)).toBe(10)
  })

  it('summarizes one Project in isolation (counts + its own token groups)', () => {
    const zeros = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
    insertUsageEvents(db, [
      makeEvent({ eventId: 'a', encodedPath: '-a', sessionId: 's1', ...zeros, inputTokens: 10 }),
      makeEvent({ eventId: 'b', encodedPath: '-a', sessionId: 's2', ...zeros, outputTokens: 5 }),
      makeEvent({ eventId: 'c', encodedPath: '-b', sessionId: 's3', ...zeros, inputTokens: 99 })
    ])
    const a = projectUsageCounts(db, '-a')
    expect(a.eventCount).toBe(2)
    expect(a.sessionCount).toBe(2)
    expect(a.tokens).toBe(15)
    // Only -a's groups come back.
    const groups = sumTokensByGroupForProject(db, '-a')
    expect(groups.reduce((s, g) => s + g.inputTokens + g.outputTokens, 0)).toBe(15)
  })

  it('wipeAllUsage drops events and cursors together (rebuild path)', () => {
    insertUsageEvents(db, [makeEvent({ eventId: 'a' })])
    setIngestCursor(db, '/p/s1.jsonl', { byteOffset: 100, lineCount: 3 }, '2026-07-13T12:00:00Z')
    wipeAllUsage(db)
    expect(usageEventCount(db)).toBe(0)
    expect(getIngestCursor(db, '/p/s1.jsonl')).toBeNull()
  })
})
