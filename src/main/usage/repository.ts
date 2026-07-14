import type Database from 'better-sqlite3'
import type { UsageEvent } from '@shared/types'
import type { TokenGroup } from './cost'

/**
 * Persistence for the rebuildable Usage Events cache (ADR-0009). Inserts
 * are idempotent by `event_id`, so re-ingesting a file (or the whole
 * sweep) never double-counts. Everything here is derivable from JSONL;
 * `wipeAll` + a re-sweep must reproduce the identical table.
 */

export interface IngestCursor {
  byteOffset: number
  lineCount: number
}

/** Insert-or-ignore a batch of Usage Events. Returns how many rows were new. */
export function insertUsageEvents(db: Database.Database, events: readonly UsageEvent[]): number {
  if (events.length === 0) return 0
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO usage_events (
       event_id, encoded_path, session_id, timestamp, model,
       input_tokens, cache_read_tokens, cache_write_tokens, output_tokens,
       service_tier, git_branch, cwd, source_file, source_line
     ) VALUES (
       @eventId, @encodedPath, @sessionId, @timestamp, @model,
       @inputTokens, @cacheReadTokens, @cacheWriteTokens, @outputTokens,
       @serviceTier, @gitBranch, @cwd, @sourceFile, @sourceLine
     )`
  )
  let inserted = 0
  const insertMany = db.transaction((rows: readonly UsageEvent[]) => {
    for (const row of rows) {
      const info = stmt.run(row)
      inserted += info.changes
    }
  })
  insertMany(events)
  return inserted
}

export function getIngestCursor(db: Database.Database, sourceFile: string): IngestCursor | null {
  const row = db
    .prepare('SELECT byte_offset, line_count FROM usage_ingest_state WHERE source_file = ?')
    .get(sourceFile) as { byte_offset: number; line_count: number } | undefined
  return row ? { byteOffset: row.byte_offset, lineCount: row.line_count } : null
}

export function setIngestCursor(
  db: Database.Database,
  sourceFile: string,
  cursor: IngestCursor,
  at: string
): void {
  db.prepare(
    `INSERT INTO usage_ingest_state (source_file, byte_offset, line_count, updated_at)
     VALUES (@sourceFile, @byteOffset, @lineCount, @updatedAt)
     ON CONFLICT(source_file) DO UPDATE SET
       byte_offset = excluded.byte_offset,
       line_count = excluded.line_count,
       updated_at = excluded.updated_at`
  ).run({
    sourceFile,
    byteOffset: cursor.byteOffset,
    lineCount: cursor.lineCount,
    updatedAt: at
  })
}

/** Drop the entire cache + all ingest cursors — the manual Rebuild path. */
export function wipeAllUsage(db: Database.Database): void {
  const wipe = db.transaction(() => {
    db.exec('DELETE FROM usage_events')
    db.exec('DELETE FROM usage_ingest_state')
  })
  wipe()
}

export function usageEventCount(db: Database.Database): number {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM usage_events').get() as { n: number }
  return n
}

/** Headline counts for the dashboard stat cards. */
export function usageSummaryCounts(db: Database.Database): {
  eventCount: number
  sessionCount: number
  totalTokens: number
} {
  return db
    .prepare(
      `SELECT
         COUNT(*) AS eventCount,
         COUNT(DISTINCT session_id) AS sessionCount,
         COALESCE(SUM(input_tokens + cache_read_tokens + cache_write_tokens + output_tokens), 0)
           AS totalTokens
       FROM usage_events`
    )
    .get() as { eventCount: number; sessionCount: number; totalTokens: number }
}

/**
 * Token totals grouped by (day, model, service_tier). The day is the
 * UTC calendar date (`substr(timestamp,1,10)`); grouping by model+tier
 * lets the caller price each day's Notional Cost accurately.
 */
export function sumTokensByDayAndGroup(
  db: Database.Database
): Array<TokenGroup & { day: string }> {
  return db
    .prepare(
      `SELECT
         substr(timestamp, 1, 10) AS day,
         model,
         service_tier AS serviceTier,
         SUM(input_tokens) AS inputTokens,
         SUM(cache_read_tokens) AS cacheReadTokens,
         SUM(cache_write_tokens) AS cacheWriteTokens,
         SUM(output_tokens) AS outputTokens
       FROM usage_events
       GROUP BY day, model, service_tier
       ORDER BY day`
    )
    .all() as Array<TokenGroup & { day: string }>
}

/** Token groups keyed by an extra column (encoded_path / session_id) for per-entity cost. */
type KeyedGroup<K extends string> = TokenGroup & Record<K, string | null>

export function sumTokensByProjectGroup(db: Database.Database): Array<KeyedGroup<'encodedPath'>> {
  return db
    .prepare(
      `SELECT encoded_path AS encodedPath, model, service_tier AS serviceTier,
         SUM(input_tokens) AS inputTokens, SUM(cache_read_tokens) AS cacheReadTokens,
         SUM(cache_write_tokens) AS cacheWriteTokens, SUM(output_tokens) AS outputTokens
       FROM usage_events GROUP BY encoded_path, model, service_tier`
    )
    .all() as Array<KeyedGroup<'encodedPath'>>
}

export function projectMeta(
  db: Database.Database
): Array<{ encodedPath: string; sessionCount: number; tokens: number; lastActivity: string }> {
  return db
    .prepare(
      `SELECT encoded_path AS encodedPath,
         COUNT(DISTINCT session_id) AS sessionCount,
         SUM(input_tokens + cache_read_tokens + cache_write_tokens + output_tokens) AS tokens,
         MAX(timestamp) AS lastActivity
       FROM usage_events GROUP BY encoded_path`
    )
    .all() as Array<{ encodedPath: string; sessionCount: number; tokens: number; lastActivity: string }>
}

export function sumTokensBySessionGroup(db: Database.Database): Array<KeyedGroup<'sessionId'>> {
  return db
    .prepare(
      `SELECT session_id AS sessionId, model, service_tier AS serviceTier,
         SUM(input_tokens) AS inputTokens, SUM(cache_read_tokens) AS cacheReadTokens,
         SUM(cache_write_tokens) AS cacheWriteTokens, SUM(output_tokens) AS outputTokens
       FROM usage_events GROUP BY session_id, model, service_tier`
    )
    .all() as Array<KeyedGroup<'sessionId'>>
}

export interface SessionMetaRow {
  sessionId: string
  encodedPath: string
  eventCount: number
  tokens: number
  firstActivity: string
  lastActivity: string
}

export function sessionMeta(db: Database.Database): SessionMetaRow[] {
  return db
    .prepare(
      `SELECT session_id AS sessionId, encoded_path AS encodedPath,
         COUNT(*) AS eventCount,
         SUM(input_tokens + cache_read_tokens + cache_write_tokens + output_tokens) AS tokens,
         MIN(timestamp) AS firstActivity,
         MAX(timestamp) AS lastActivity
       FROM usage_events GROUP BY session_id`
    )
    .all() as SessionMetaRow[]
}

/** Headline counts for one Project — the Project Screen's Usage strip. */
export function projectUsageCounts(
  db: Database.Database,
  encodedPath: string
): { eventCount: number; sessionCount: number; tokens: number } {
  return db
    .prepare(
      `SELECT
         COUNT(*) AS eventCount,
         COUNT(DISTINCT session_id) AS sessionCount,
         COALESCE(SUM(input_tokens + cache_read_tokens + cache_write_tokens + output_tokens), 0)
           AS tokens
       FROM usage_events WHERE encoded_path = ?`
    )
    .get(encodedPath) as { eventCount: number; sessionCount: number; tokens: number }
}

/** Token groups for one Project (model, service_tier) — the input to its Notional Cost. */
export function sumTokensByGroupForProject(
  db: Database.Database,
  encodedPath: string
): TokenGroup[] {
  return db
    .prepare(
      `SELECT model, service_tier AS serviceTier,
         SUM(input_tokens) AS inputTokens, SUM(cache_read_tokens) AS cacheReadTokens,
         SUM(cache_write_tokens) AS cacheWriteTokens, SUM(output_tokens) AS outputTokens
       FROM usage_events WHERE encoded_path = ? GROUP BY model, service_tier`
    )
    .all(encodedPath) as TokenGroup[]
}

/** Distinct Sessions active in a given `YYYY-MM` month (UTC). */
export function countSessionsInMonth(db: Database.Database, monthPrefix: string): number {
  const { n } = db
    .prepare(
      `SELECT COUNT(DISTINCT session_id) AS n FROM usage_events WHERE substr(timestamp, 1, 7) = ?`
    )
    .get(monthPrefix) as { n: number }
  return n
}

/** Per-turn rows for one Session, oldest-first — the drill-down source. */
export function sessionEventRows(
  db: Database.Database,
  sessionId: string
): Array<TokenGroup & { eventId: string; timestamp: string }> {
  return db
    .prepare(
      `SELECT event_id AS eventId, timestamp, model, service_tier AS serviceTier,
         input_tokens AS inputTokens, cache_read_tokens AS cacheReadTokens,
         cache_write_tokens AS cacheWriteTokens, output_tokens AS outputTokens
       FROM usage_events WHERE session_id = ? ORDER BY timestamp`
    )
    .all(sessionId) as Array<TokenGroup & { eventId: string; timestamp: string }>
}

/**
 * Token totals grouped by (model, service_tier) — the input to Notional
 * Cost. Grouping by tier keeps the cost service-tier aware.
 */
export function sumTokensByGroup(db: Database.Database): TokenGroup[] {
  const rows = db
    .prepare(
      `SELECT
         model,
         service_tier AS serviceTier,
         SUM(input_tokens) AS inputTokens,
         SUM(cache_read_tokens) AS cacheReadTokens,
         SUM(cache_write_tokens) AS cacheWriteTokens,
         SUM(output_tokens) AS outputTokens
       FROM usage_events
       GROUP BY model, service_tier`
    )
    .all() as Array<{
    model: string | null
    serviceTier: string | null
    inputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    outputTokens: number
  }>
  return rows
}
