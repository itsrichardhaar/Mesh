import type Database from 'better-sqlite3'
import type { ProjectPatch } from '@shared/types'
import type { DiscoveredProject } from './enumerator'

/**
 * The Mesh-owned augmentation we store per Project on top of the filesystem-
 * derived data. Slice 3 introduces `hidden`; later slices add more columns.
 */
export interface ProjectAugmentation {
  hidden: boolean
}

const ALLOWED_PATCH_KEYS: ReadonlySet<keyof ProjectPatch> = new Set(['hidden'])

/**
 * Insert or update one row per Project discovered on disk. Filesystem-derived
 * columns (`source_path`, `source_missing`, `auto_name`) are overwritten on
 * each call; user-owned augmentation columns (`hidden`, `name_override`,
 * `accent_color`, …) are left untouched.
 */
export function upsertDiscovered(
  db: Database.Database,
  discovered: readonly DiscoveredProject[]
): void {
  const stmt = db.prepare(`
    INSERT INTO projects (encoded_path, source_path, source_missing, auto_name)
    VALUES (@encoded_path, @source_path, @source_missing, @auto_name)
    ON CONFLICT(encoded_path) DO UPDATE SET
      source_path = excluded.source_path,
      source_missing = excluded.source_missing,
      auto_name = excluded.auto_name
  `)
  const run = db.transaction((items: readonly DiscoveredProject[]) => {
    for (const p of items) {
      stmt.run({
        encoded_path: p.encodedPath,
        source_path: p.sourcePath,
        source_missing: p.sourceMissing ? 1 : 0,
        auto_name: p.name
      })
    }
  })
  run(discovered)
}

/**
 * Read augmentation for every Project currently in the table. Returned as a
 * Map keyed by Encoded Path so the orchestration layer can do an O(1) join
 * against the freshly-discovered list.
 */
export function readAugmentation(
  db: Database.Database
): Map<string, ProjectAugmentation> {
  const rows = db
    .prepare('SELECT encoded_path AS encodedPath, hidden FROM projects')
    .all() as Array<{ encodedPath: string; hidden: number }>

  const map = new Map<string, ProjectAugmentation>()
  for (const row of rows) {
    map.set(row.encodedPath, { hidden: row.hidden === 1 })
  }
  return map
}

/**
 * Apply a typed patch to a Project's augmentation columns. Throws on unknown
 * keys so the IPC handler can surface a clean error rather than silently
 * dropping fields. No-op if `patch` is empty after filtering.
 */
export function updateProject(
  db: Database.Database,
  encodedPath: string,
  patch: ProjectPatch
): void {
  const sets: string[] = []
  const params: Record<string, unknown> = { encoded_path: encodedPath }

  for (const key of Object.keys(patch) as Array<keyof ProjectPatch>) {
    if (!ALLOWED_PATCH_KEYS.has(key)) {
      throw new Error(`updateProject: unknown patch key "${String(key)}"`)
    }
    if (key === 'hidden' && patch.hidden !== undefined) {
      sets.push('hidden = @hidden')
      params.hidden = patch.hidden ? 1 : 0
    }
  }

  if (sets.length === 0) return

  db.prepare(
    `UPDATE projects SET ${sets.join(', ')} WHERE encoded_path = @encoded_path`
  ).run(params)
}
