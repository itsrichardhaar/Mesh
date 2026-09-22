/**
 * Ring-fenced, read-only, best-effort reader of `no-mistakes`' private state
 * store (`~/.no-mistakes/state.sqlite`) — the second local-first exception,
 * alongside the networked Quota fetch (ADR-0011, ADR-0014).
 *
 * Slice B reads only the `repos` table (`id → working_path`) to attribute a
 * Gate Run to the real Project it validated. The run enrichment (`runs` table)
 * lands in Slice C on top of the same reader.
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

/**
 * Caches {@link readRepoWorkingPaths} for `ttlMs` so a single `projects:list`
 * (and rapid successive refreshes) reopen the store at most once per window.
 */
export class NoMistakesStateReader {
  private cache: { at: number; repos: Map<string, string> } | null = null

  constructor(private readonly deps: StateReaderDeps = {}) {}

  /** `repoId → working_path`, best-effort and empty on any failure. */
  readRepoWorkingPaths(): Map<string, string> {
    const now = (this.deps.now ?? Date.now)()
    const ttl = this.deps.ttlMs ?? DEFAULT_STATE_TTL_MS
    if (this.cache && now - this.cache.at < ttl) return this.cache.repos

    const repos = readRepoWorkingPaths(this.deps.dbPath ?? DEFAULT_STATE_DB_PATH)
    this.cache = { at: now, repos }
    return repos
  }
}
