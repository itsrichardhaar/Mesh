import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type Database from 'better-sqlite3'
import type { UsageEvent } from '@shared/types'
import { parseUsageLine } from './parse'
import {
  getIngestCursor,
  insertUsageEvents,
  setIngestCursor,
  type IngestCursor
} from './repository'

/**
 * Usage ingest (ADR-0009). A sweep over all Projects' Session JSONL
 * derives Usage Events into the rebuildable cache. Freshness is
 * tail-based: each file carries a byte-offset cursor, so re-ingesting a
 * grown file parses only the appended, newline-complete tail — never the
 * whole file. `event_id` (message uuid) idempotency is the backstop.
 */

/**
 * Pure tail parse: given a file's full buffer and the prior cursor,
 * return the newly-appended Usage Events and the advanced cursor.
 * Only whole lines (up to the last newline) are consumed, so a
 * half-written trailing line is left for the next pass. A file that
 * shrank below the cursor (truncated/replaced) resets to the start.
 */
export function tailParse(
  buf: Buffer,
  prior: IngestCursor | null,
  ctx: { encodedPath: string; sessionId: string; sourceFile: string }
): { events: UsageEvent[]; cursor: IngestCursor } {
  let startByte = prior?.byteOffset ?? 0
  let startLine = prior?.lineCount ?? 0
  if (startByte > buf.length) {
    // File truncated or replaced — re-ingest from scratch.
    startByte = 0
    startLine = 0
  }

  const slice = buf.subarray(startByte)
  const lastNewline = slice.lastIndexOf(0x0a)
  if (lastNewline === -1) {
    // No complete new line yet.
    return { events: [], cursor: { byteOffset: startByte, lineCount: startLine } }
  }

  const complete = slice.subarray(0, lastNewline + 1)
  const text = complete.toString('utf8')
  // Trailing '' after the final newline is dropped; interior blank lines
  // still advance the line counter so source_line stays accurate.
  const lines = text.split('\n')
  lines.pop()

  const events: UsageEvent[] = []
  lines.forEach((line, i) => {
    const event = parseUsageLine(line, {
      encodedPath: ctx.encodedPath,
      sessionId: ctx.sessionId,
      sourceFile: ctx.sourceFile,
      lineNumber: startLine + i + 1
    })
    if (event) events.push(event)
  })

  return {
    events,
    cursor: {
      byteOffset: startByte + complete.length,
      lineCount: startLine + lines.length
    }
  }
}

/** Ingest a single Session JSONL file's appended tail. Returns rows inserted. */
export function ingestFile(
  db: Database.Database,
  sourceFile: string,
  encodedPath: string,
  now: () => string
): number {
  let buf: Buffer
  try {
    buf = readFileSync(sourceFile)
  } catch {
    return 0 // File vanished between listing and read — skip.
  }
  const sessionId = basename(sourceFile).replace(/\.jsonl$/, '')
  const { events, cursor } = tailParse(buf, getIngestCursor(db, sourceFile), {
    encodedPath,
    sessionId,
    sourceFile
  })
  const inserted = insertUsageEvents(db, events)
  setIngestCursor(db, sourceFile, cursor, now())
  return inserted
}

function jsonlFilesIn(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => join(dir, name))
  } catch {
    return []
  }
}

/** Ingest every Session file in one Project's folder. Returns rows inserted. */
export function ingestProject(
  db: Database.Database,
  projectsDir: string,
  encodedPath: string,
  now: () => string
): number {
  const dir = join(projectsDir, encodedPath)
  let inserted = 0
  for (const file of jsonlFilesIn(dir)) {
    inserted += ingestFile(db, file, encodedPath, now)
  }
  return inserted
}

/** Every Project folder name (Encoded Path) under `projectsDir`. */
export function projectDirNames(projectsDir: string): string[] {
  try {
    return readdirSync(projectsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/**
 * Full sweep over every Project folder under `projectsDir`. Each folder
 * name is an Encoded Path (Claude Code's own scheme). Cheap after the
 * first pass — unchanged files contribute no new tail. (The main process
 * runs an equivalent sweep that yields between Projects to stay
 * non-blocking; this synchronous form is for tests and one-shot use.)
 */
export function sweepAll(
  db: Database.Database,
  projectsDir: string,
  now: () => string
): number {
  let inserted = 0
  for (const encodedPath of projectDirNames(projectsDir)) {
    inserted += ingestProject(db, projectsDir, encodedPath, now)
  }
  return inserted
}
