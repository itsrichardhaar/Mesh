/**
 * Ring-fenced, read-only, best-effort reader of `no-mistakes`' private state
 * store (`~/.no-mistakes/state.sqlite`) — the second local-first exception,
 * alongside the networked Quota fetch (ADR-0011, ADR-0014).
 *
 * Slice B reads the `repos` table (`id → working_path`) to attribute a Gate Run
 * to the real Project it validated. Slice C adds the `runs` table read
 * (`id → { status, prUrl, prState, branch, intent }`) so each Gate Run row reads
 * like a validation run rather than a ULID — both on top of the same reader.
 *
 * Everything here is best-effort: an absent file, a lock, or a shape change
 * resolves to an **empty map**, never a throw. The DB is opened read-only and
 * closed immediately; a short in-process cache keeps `projects:list` from
 * re-opening it on every sidebar refresh.
 */
import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { GateRunMeta } from '@shared/types'

/**
 * The subset of {@link GateRunMeta} enriched from the `runs` table (Slice C).
 * `repoId`/`runId` come from path recognition and aren't re-read here.
 */
export type GateRunEnrichment = Pick<
  GateRunMeta,
  'status' | 'prUrl' | 'prState' | 'branch' | 'intent'
>

/** Default location of no-mistakes' state store. */
export const DEFAULT_STATE_DB_PATH = join(homedir(), '.no-mistakes', 'state.sqlite')

/** Cache lifetime. The store changes slowly relative to sidebar refreshes. */
export const DEFAULT_STATE_TTL_MS = 5_000

export interface StateReaderDeps {
  /** Path to `state.sqlite`. Tests point this at a seeded temp DB. */
  dbPath?: string
  now?: () => number
  ttlMs?: number
}

/**
 * Reads `state.sqlite` once, returning `repoId → working_path`. Best-effort:
 * any failure (absent / locked / shape-changed) yields an empty map. Exported
 * for direct testing; production goes through {@link NoMistakesStateReader}
 * for the cache.
 */
export function readRepoWorkingPaths(dbPath: string): Map<string, string> {
  const repos = new Map<string, string>()
  if (!existsSync(dbPath)) return repos

  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const rows = db.prepare('SELECT id, working_path FROM repos').all() as Array<{
      id: unknown
      working_path: unknown
    }>
    for (const row of rows) {
      if (
        typeof row.id === 'string' &&
        row.id.length > 0 &&
        typeof row.working_path === 'string' &&
        row.working_path.length > 0
      ) {
        repos.set(row.id, row.working_path)
      }
    }
  } catch {
    // Absent, locked, or shape-changed — degrade to the synthetic-node
    // fallback (ADR-0014). Never surface, never throw.
    return new Map()
  } finally {
    db?.close()
  }
  return repos
}

/** A run status the sidebar renders a glyph for; other values carry no glyph. */
function normalizeStatus(value: unknown): GateRunEnrichment['status'] {
  return value === 'completed' || value === 'failed' ? value : null
}

/** A non-empty string, or `null` — the shape every nullable text column maps to. */
function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Reads `state.sqlite` once, returning `runId → {@link GateRunEnrichment}` for
 * every `runs` row. Best-effort with the same posture as
 * {@link readRepoWorkingPaths}: any failure (absent / locked / shape-changed)
 * yields an empty map, so a Gate Run simply renders with the ids it already
 * has. Exported for direct testing; production goes through
 * {@link NoMistakesStateReader} for the cache.
 */
export function readRunEnrichment(dbPath: string): Map<string, GateRunEnrichment> {
  const runs = new Map<string, GateRunEnrichment>()
  if (!existsSync(dbPath)) return runs

  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const rows = db
      .prepare('SELECT id, status, pr_url, pr_state, branch, intent FROM runs')
      .all() as Array<{
      id: unknown
      status: unknown
      pr_url: unknown
      pr_state: unknown
      branch: unknown
      intent: unknown
    }>
    for (const row of rows) {
      if (typeof row.id !== 'string' || row.id.length === 0) continue
      runs.set(row.id, {
        status: normalizeStatus(row.status),
        prUrl: stringOrNull(row.pr_url),
        prState: stringOrNull(row.pr_state),
        branch: stringOrNull(row.branch),
        intent: stringOrNull(row.intent)
      })
    }
  } catch {
    // Absent, locked, or shape-changed — degrade to un-enriched ids (ADR-0014).
    // Never surface, never throw.
    return new Map()
  } finally {
    db?.close()
  }
  return runs
}

/**
 * Caches the ring-fenced reads for `ttlMs` so a single `projects:list` (and
 * rapid successive refreshes) reopen the store at most once per window. The
 * `repos` and `runs` reads share one cache slot — a `projects:list` needs both,
 * so they're read together on a miss.
 */
export class NoMistakesStateReader {
  private cache: {
    at: number
    repos: Map<string, string>
    runs: Map<string, GateRunEnrichment>
  } | null = null

  constructor(private readonly deps: StateReaderDeps = {}) {}

  /** `repoId → working_path`, best-effort and empty on any failure. */
  readRepoWorkingPaths(): Map<string, string> {
    return this.read().repos
  }

  /** `runId → {@link GateRunEnrichment}`, best-effort and empty on any failure. */
  readRunEnrichment(): Map<string, GateRunEnrichment> {
    return this.read().runs
  }

  private read(): { repos: Map<string, string>; runs: Map<string, GateRunEnrichment> } {
    const now = (this.deps.now ?? Date.now)()
    const ttl = this.deps.ttlMs ?? DEFAULT_STATE_TTL_MS
    if (this.cache && now - this.cache.at < ttl) return this.cache

    const dbPath = this.deps.dbPath ?? DEFAULT_STATE_DB_PATH
    this.cache = { at: now, repos: readRepoWorkingPaths(dbPath), runs: readRunEnrichment(dbPath) }
    return this.cache
  }
}
