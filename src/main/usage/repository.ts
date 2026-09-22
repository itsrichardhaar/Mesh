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

/**
 * A resolved Usage Filter for the dashboard's view queries (v10 / ADR-0013):
 * an inclusive timestamp range plus an optional Project. Absent/empty fields
 * are omitted from the `WHERE`, so an empty filter reproduces the original
 * all-time / all-project behavior — existing callers pass nothing.
 */
export interface UsageQueryFilter {
  start?: string | null
  end?: string | null
  encodedPath?: string | null
  /**
   * A set of Encoded Paths to scope to (v11 / ADR-0014, Slice D): a Parent
   * Project selected in the Usage Filter expands to `[parent, ...its runs]`
   * so a run's events count toward the Parent. Emitted as `encoded_path IN
   * (…)`; takes precedence over the single `encodedPath` when non-empty.
   */
  encodedPaths?: readonly string[] | null
}

/** Build a `WHERE …` fragment (+ named params) from a Usage Filter. */
function buildWhere(filter?: UsageQueryFilter): { sql: string; params: Record<string, string> } {
  const clauses: string[] = []
  const params: Record<string, string> = {}
  if (filter?.start) {
    clauses.push('timestamp >= @fStart')
    params.fStart = filter.start
  }
  if (filter?.end) {
    clauses.push('timestamp <= @fEnd')
    params.fEnd = filter.end
  }
  if (filter?.encodedPaths && filter.encodedPaths.length > 0) {
    const { sql, params: inParams } = encodedPathIn(filter.encodedPaths)
    Object.assign(params, inParams)
    clauses.push(sql)
  } else if (filter?.encodedPath) {
    clauses.push('encoded_path = @fEncodedPath')
    params.fEncodedPath = filter.encodedPath
  }
  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')} ` : '', params }
}

/**
 * Named-param `encoded_path IN (…)` fragment for a list of Encoded Paths — the
 * single place a member set (Parent + its runs, v11 / ADR-0014) becomes SQL.
 * Reused by {@link buildWhere} and the Parent-scoped Project queries.
 */
function encodedPathIn(encodedPaths: readonly string[]): {
  sql: string
  params: Record<string, string>
} {
  const params: Record<string, string> = {}
  const names = encodedPaths.map((path, i) => {
    const name = `ep${i}`
    params[name] = path
    return `@${name}`
  })
  return { sql: `encoded_path IN (${names.join(', ')})`, params }
}

/** Run a prepared query, binding named params only when there are any. */
function allWith<T>(db: Database.Database, sql: string, params: Record<string, string>): T[] {
  const stmt = db.prepare(sql)
  return (Object.keys(params).length > 0 ? stmt.all(params) : stmt.all()) as T[]
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
  db: Database.Database,
  filter?: UsageQueryFilter
): Array<TokenGroup & { day: string }> {
  const { sql, params } = buildWhere(filter)
  return allWith<TokenGroup & { day: string }>(
    db,
    `SELECT
       substr(timestamp, 1, 10) AS day,
       model,
       service_tier AS serviceTier,
       SUM(input_tokens) AS inputTokens,
       SUM(cache_read_tokens) AS cacheReadTokens,
       SUM(cache_write_tokens) AS cacheWriteTokens,
       SUM(output_tokens) AS outputTokens
     FROM usage_events
     ${sql}GROUP BY day, model, service_tier
     ORDER BY day`,
    params
  )
}

/** Token groups keyed by an extra column (encoded_path / session_id) for per-entity cost. */
type KeyedGroup<K extends string> = TokenGroup & Record<K, string | null>

export function sumTokensByProjectGroup(
  db: Database.Database,
  filter?: UsageQueryFilter
): Array<KeyedGroup<'encodedPath'>> {
  const { sql, params } = buildWhere(filter)
  return allWith<KeyedGroup<'encodedPath'>>(
    db,
    `SELECT encoded_path AS encodedPath, model, service_tier AS serviceTier,
       SUM(input_tokens) AS inputTokens, SUM(cache_read_tokens) AS cacheReadTokens,
       SUM(cache_write_tokens) AS cacheWriteTokens, SUM(output_tokens) AS outputTokens
     FROM usage_events ${sql}GROUP BY encoded_path, model, service_tier`,
    params
  )
}

export function projectMeta(
  db: Database.Database,
  filter?: UsageQueryFilter
): Array<{ encodedPath: string; sessionCount: number; tokens: number; lastActivity: string }> {
  const { sql, params } = buildWhere(filter)
  return allWith<{ encodedPath: string; sessionCount: number; tokens: number; lastActivity: string }>(
    db,
    `SELECT encoded_path AS encodedPath,
       COUNT(DISTINCT session_id) AS sessionCount,
       SUM(input_tokens + cache_read_tokens + cache_write_tokens + output_tokens) AS tokens,
       MAX(timestamp) AS lastActivity
     FROM usage_events ${sql}GROUP BY encoded_path`,
    params
  )
}

export function sumTokensBySessionGroup(
  db: Database.Database,
  filter?: UsageQueryFilter
): Array<KeyedGroup<'sessionId'>> {
  const { sql, params } = buildWhere(filter)
  return allWith<KeyedGroup<'sessionId'>>(
    db,
    `SELECT session_id AS sessionId, model, service_tier AS serviceTier,
       SUM(input_tokens) AS inputTokens, SUM(cache_read_tokens) AS cacheReadTokens,
       SUM(cache_write_tokens) AS cacheWriteTokens, SUM(output_tokens) AS outputTokens
     FROM usage_events ${sql}GROUP BY session_id, model, service_tier`,
    params
  )
}

export interface SessionMetaRow {
  sessionId: string
  encodedPath: string
  eventCount: number
  tokens: number
  firstActivity: string
  lastActivity: string
}

export function sessionMeta(db: Database.Database, filter?: UsageQueryFilter): SessionMetaRow[] {
  const { sql, params } = buildWhere(filter)
  return allWith<SessionMetaRow>(
    db,
    `SELECT session_id AS sessionId, encoded_path AS encodedPath,
       COUNT(*) AS eventCount,
       SUM(input_tokens + cache_read_tokens + cache_write_tokens + output_tokens) AS tokens,
       MIN(timestamp) AS firstActivity,
       MAX(timestamp) AS lastActivity
     FROM usage_events ${sql}GROUP BY session_id`,
    params
  )
}

/**
 * Headline counts for one Project — the Project Screen's Usage strip. Pass the
 * Parent's member set (`[parent, ...runs]`, v11 / ADR-0014) so a Worktree Run's
 * events count toward the Parent, including its distinct Session count.
 */
export function projectUsageCounts(
  db: Database.Database,
  encodedPaths: readonly string[]
): { eventCount: number; sessionCount: number; tokens: number } {
  if (encodedPaths.length === 0) return { eventCount: 0, sessionCount: 0, tokens: 0 }
  const { sql, params } = encodedPathIn(encodedPaths)
  return db
    .prepare(
      `SELECT
         COUNT(*) AS eventCount,
         COUNT(DISTINCT session_id) AS sessionCount,
         COALESCE(SUM(input_tokens + cache_read_tokens + cache_write_tokens + output_tokens), 0)
           AS tokens
       FROM usage_events WHERE ${sql}`
    )
    .get(params) as { eventCount: number; sessionCount: number; tokens: number }
}

/**
 * Token groups (model, service_tier) for one Project — the input to its
 * Notional Cost. Takes the Parent's member set so a run's spend rolls up
 * (v11 / ADR-0014).
 */
export function sumTokensByGroupForProject(
  db: Database.Database,
  encodedPaths: readonly string[]
): TokenGroup[] {
  if (encodedPaths.length === 0) return []
  const { sql, params } = encodedPathIn(encodedPaths)
  return db
    .prepare(
      `SELECT model, service_tier AS serviceTier,
         SUM(input_tokens) AS inputTokens, SUM(cache_read_tokens) AS cacheReadTokens,
         SUM(cache_write_tokens) AS cacheWriteTokens, SUM(output_tokens) AS outputTokens
       FROM usage_events WHERE ${sql} GROUP BY model, service_tier`
    )
    .all(params) as TokenGroup[]
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

/**
 * Global Metric Cards support (v10 / Slice 72). These read a half-open
 * `[startUtc, endUtc)` window and ignore the Usage Filter entirely — the
 * cards are global. Boundaries are UTC ISO strings the caller computed
 * from the user's *local* day (main runs in the user's tz), so string
 * comparison against `timestamp` buckets to the correct local day. All
 * three ride `idx_usage_events_time`.
 */

const RANGE_TOKENS = 'input_tokens + cache_read_tokens + cache_write_tokens + output_tokens'

/** Total tokens + distinct Sessions active in `[startUtc, endUtc)`. */
export function rangeTokensAndSessions(
  db: Database.Database,
  startUtc: string,
  endUtc: string
): { tokens: number; sessions: number } {
  return db
    .prepare(
      `SELECT
         COALESCE(SUM(${RANGE_TOKENS}), 0) AS tokens,
         COUNT(DISTINCT session_id) AS sessions
       FROM usage_events WHERE timestamp >= @start AND timestamp < @end`
    )
    .get({ start: startUtc, end: endUtc }) as { tokens: number; sessions: number }
}

/**
 * Count of distinct **local** calendar days with any usage in
 * `[startUtc, endUtc)`. `shift` is a SQLite datetime modifier (e.g.
 * `'-480 minutes'`) that maps each stored UTC timestamp to local wall
 * clock before the date is taken — so an event just after UTC midnight
 * counts against the correct local day (grill decision #4).
 */
export function rangeActiveDays(
  db: Database.Database,
  startUtc: string,
  endUtc: string,
  shift: string
): number {
  const { n } = db
    .prepare(
      `SELECT COUNT(DISTINCT substr(datetime(timestamp, @shift), 1, 10)) AS n
       FROM usage_events WHERE timestamp >= @start AND timestamp < @end`
    )
    .get({ start: startUtc, end: endUtc, shift }) as { n: number }
  return n
}

/** Token groups (model, tier) in `[startUtc, endUtc)` — the input to month Notional Cost. */
export function rangeTokenGroups(
  db: Database.Database,
  startUtc: string,
  endUtc: string
): TokenGroup[] {
  return db
    .prepare(
      `SELECT model, service_tier AS serviceTier,
         SUM(input_tokens) AS inputTokens, SUM(cache_read_tokens) AS cacheReadTokens,
         SUM(cache_write_tokens) AS cacheWriteTokens, SUM(output_tokens) AS outputTokens
       FROM usage_events WHERE timestamp >= @start AND timestamp < @end
       GROUP BY model, service_tier`
    )
    .all({ start: startUtc, end: endUtc }) as TokenGroup[]
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
export function sumTokensByGroup(db: Database.Database, filter?: UsageQueryFilter): TokenGroup[] {
  const { sql, params } = buildWhere(filter)
  return allWith<TokenGroup>(
    db,
    `SELECT
       model,
       service_tier AS serviceTier,
       SUM(input_tokens) AS inputTokens,
       SUM(cache_read_tokens) AS cacheReadTokens,
       SUM(cache_write_tokens) AS cacheWriteTokens,
       SUM(output_tokens) AS outputTokens
     FROM usage_events
     ${sql}GROUP BY model, service_tier`,
    params
  )
}
