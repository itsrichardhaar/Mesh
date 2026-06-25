import type Database from 'better-sqlite3'
import type {
  AnalysisOutput,
  ProviderId,
  StoredAnalysis
} from '@shared/types'
import { isProviderId } from '@shared/types'

/**
 * Shape passed in when persisting a new Analysis. The Slice 10
 * `AnalysisOrchestrator` calls `insertAnalysis(db, …)` with this on
 * success; on failure (Slice 12) it passes status='failed' and a
 * non-null `errorMessage` instead of `content`.
 */
export interface AnalysisInsert {
  encodedPath: string
  generatedAt: string
  status: 'ok' | 'failed'
  errorMessage?: string | null
  provider: ProviderId
  model: string
  sourceSessionCount?: number | null
  lastAnalyzedSha?: string | null
  content?: AnalysisOutput | null
}

/**
 * Append a row to `analyses`. The composite primary key
 * `(encoded_path, generated_at)` enforces history retention — callers
 * must pass a fresh `generatedAt` per Analyze call. Throws on a
 * collision rather than silently overwriting.
 */
export function insertAnalysis(db: Database.Database, row: AnalysisInsert): void {
  db.prepare(
    `INSERT INTO analyses (
       encoded_path, generated_at, status, error_message,
       provider, model,
       source_session_count, last_analyzed_sha,
       summary_md, next_steps_json, suggested_improvements_json
     ) VALUES (
       @encoded_path, @generated_at, @status, @error_message,
       @provider, @model,
       @source_session_count, @last_analyzed_sha,
       @summary_md, @next_steps_json, @suggested_improvements_json
     )`
  ).run({
    encoded_path: row.encodedPath,
    generated_at: row.generatedAt,
    status: row.status,
    error_message: row.errorMessage ?? null,
    provider: row.provider,
    model: row.model,
    source_session_count: row.sourceSessionCount ?? null,
    last_analyzed_sha: row.lastAnalyzedSha ?? null,
    summary_md: row.content?.summaryMarkdown ?? null,
    next_steps_json: row.content ? JSON.stringify(row.content.nextSteps) : null,
    suggested_improvements_json: row.content
      ? JSON.stringify(row.content.suggestedImprovements)
      : null
  })
}

/**
 * Return the newest Analysis for `encodedPath`, or `null` when none
 * has ever been written. The newest-first index makes this an O(log n)
 * lookup regardless of how much history accumulates.
 */
export function latestForProject(
  db: Database.Database,
  encodedPath: string
): StoredAnalysis | null {
  const row = db
    .prepare(
      `SELECT encoded_path, generated_at, status, error_message,
              provider, model,
              source_session_count, last_analyzed_sha,
              summary_md, next_steps_json, suggested_improvements_json
         FROM analyses
        WHERE encoded_path = ?
        ORDER BY generated_at DESC
        LIMIT 1`
    )
    .get(encodedPath) as RawAnalysisRow | undefined
  if (!row) return null
  return hydrate(row)
}

interface RawAnalysisRow {
  encoded_path: string
  generated_at: string
  status: string
  error_message: string | null
  provider: string
  model: string
  source_session_count: number | null
  last_analyzed_sha: string | null
  summary_md: string | null
  next_steps_json: string | null
  suggested_improvements_json: string | null
}

function hydrate(row: RawAnalysisRow): StoredAnalysis {
  if (row.status !== 'ok' && row.status !== 'failed') {
    throw new Error(`analyses: unexpected status ${row.status}`)
  }
  if (!isProviderId(row.provider)) {
    throw new Error(`analyses: unexpected provider ${row.provider}`)
  }
  const content =
    row.status === 'ok' && row.summary_md !== null
      ? {
          summaryMarkdown: row.summary_md,
          nextSteps: parseList(row.next_steps_json),
          suggestedImprovements: parseList(row.suggested_improvements_json)
        }
      : null
  return {
    encodedPath: row.encoded_path,
    generatedAt: row.generated_at,
    status: row.status,
    errorMessage: row.error_message,
    provider: row.provider,
    model: row.model,
    sourceSessionCount: row.source_session_count,
    lastAnalyzedSha: row.last_analyzed_sha,
    content
  }
}

function parseList(json: string | null): ReadonlyArray<{ text: string }> {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is { text: string } => {
        return (
          typeof item === 'object' &&
          item !== null &&
          'text' in item &&
          typeof (item as { text: unknown }).text === 'string'
        )
      })
      .map((item) => ({ text: item.text }))
  } catch {
    return []
  }
}
