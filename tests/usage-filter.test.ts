import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@main/db/migrations'
import type { UsageEvent } from '@shared/types'
import {
  insertUsageEvents,
  sumTokensByDayAndGroup,
  sumTokensByProjectGroup,
  sessionMeta,
  type UsageQueryFilter
} from '@main/usage/repository'

/**
 * The Usage Filter's parameterized queries (v10 / Slice 69, ADR-0013): a
 * `{ start, end, encodedPath }` filter scopes the view aggregates via a
 * WHERE clause. An absent filter reproduces the all-time / all-project
 * behavior.
 */

function evt(overrides: Partial<UsageEvent>): UsageEvent {
  return {
    eventId: 'e',
    encodedPath: '-alpha',
    sessionId: 's',
    timestamp: '2026-07-13T12:00:00Z',
    model: 'claude-opus-4-8',
    inputTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    serviceTier: 'standard',
    gitBranch: null,
    cwd: '/p',
    sourceFile: '/p/s.jsonl',
    sourceLine: 1,
    ...overrides
  }
}

describe('Usage Filter — parameterized view queries', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    insertUsageEvents(db, [
      // Project alpha: June + July.
      evt({ eventId: 'a-jun', encodedPath: '-alpha', sessionId: 's-a1', timestamp: '2026-06-10T00:00:00Z', inputTokens: 100 }),
      evt({ eventId: 'a-jul', encodedPath: '-alpha', sessionId: 's-a2', timestamp: '2026-07-10T00:00:00Z', inputTokens: 200 }),
      // Project beta: July only.
      evt({ eventId: 'b-jul', encodedPath: '-beta', sessionId: 's-b1', timestamp: '2026-07-11T00:00:00Z', inputTokens: 400 })
    ])
  })
  afterEach(() => db.close())

  const tokensByDay = (filter?: UsageQueryFilter): Record<string, number> =>
    Object.fromEntries(sumTokensByDayAndGroup(db, filter).map((r) => [r.day, r.inputTokens]))

  it('no filter → all events (all-time, all-project) unchanged', () => {
    expect(tokensByDay()).toEqual({ '2026-06-10': 100, '2026-07-10': 200, '2026-07-11': 400 })
  })

  it('timeframe start bound drops days before the window', () => {
    // "This July" — only July days survive.
    const july = tokensByDay({ start: '2026-07-01T00:00:00.000Z', end: null })
    expect(july).toEqual({ '2026-07-10': 200, '2026-07-11': 400 })
    expect(july['2026-06-10']).toBeUndefined()
  })

  it('project predicate scopes to one Project', () => {
    expect(tokensByDay({ encodedPath: '-alpha' })).toEqual({ '2026-06-10': 100, '2026-07-10': 200 })
  })

  it('timeframe + project compose (both predicates apply)', () => {
    const filter = { start: '2026-07-01T00:00:00.000Z', end: null, encodedPath: '-alpha' }
    expect(tokensByDay(filter)).toEqual({ '2026-07-10': 200 })
    // by-project rows honor the same filter…
    const rows = sumTokensByProjectGroup(db, filter)
    expect(rows.map((r) => r.encodedPath)).toEqual(['-alpha'])
    // …and the sessions list is scoped to that Project + window.
    const sessions = sessionMeta(db, filter).map((s) => s.sessionId)
    expect(sessions).toEqual(['s-a2'])
  })
})
