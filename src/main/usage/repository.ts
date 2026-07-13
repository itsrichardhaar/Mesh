import type Database from 'better-sqlite3'
import type { UsageEvent } from '@shared/types'

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
