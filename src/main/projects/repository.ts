import type Database from 'better-sqlite3'
import type { ProjectPatch } from '@shared/types'
import type { DiscoveredProject } from './enumerator'
import type { DetectedMetadata } from './metadata-detector'

/**
 * The Mesh-owned augmentation we store per Project on top of the filesystem-
 * derived data. Slice 3 introduced `hidden`; Slice 4 added `autoName` and
 * `autoSubtitle` from the metadata detector. `autoName` is the humanized
 * basename; the raw basename remains in `DiscoveredProject.name`.
 */
export interface ProjectAugmentation {
  hidden: boolean
  autoName: string | null
  autoSubtitle: string | null
  lastMetadataDetectedAt: string | null
  /** Slice 43 (v5): when true, idle-detector toasts for this Project are suppressed. */
  muteNotifications: boolean
}

const ALLOWED_PATCH_KEYS: ReadonlySet<keyof ProjectPatch> = new Set([
  'hidden',
  'muteNotifications'
])

/**
 * Insert or update one row per Project discovered on disk. Filesystem-derived
 * columns (`source_path`, `source_missing`) are overwritten on each call;
 * `auto_name` is seeded with the raw basename on first insert and then left
 * for the metadata detector to overwrite with its humanized form (`upsertDetectedMetadata`).
 * User-owned augmentation columns (`hidden`, `name_override`, `accent_color`, …)
 * are likewise left untouched.
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
      source_missing = excluded.source_missing
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
    .prepare(
      `SELECT encoded_path AS encodedPath,
              hidden,
              auto_name AS autoName,
              auto_subtitle AS autoSubtitle,
              last_metadata_detected_at AS lastMetadataDetectedAt,
              mute_notifications AS muteNotifications
         FROM projects`
    )
    .all() as Array<{
    encodedPath: string
    hidden: number
    autoName: string | null
    autoSubtitle: string | null
    lastMetadataDetectedAt: string | null
    muteNotifications: number
  }>

  const map = new Map<string, ProjectAugmentation>()
  for (const row of rows) {
    map.set(row.encodedPath, {
      hidden: row.hidden === 1,
      autoName: row.autoName,
      autoSubtitle: row.autoSubtitle,
      lastMetadataDetectedAt: row.lastMetadataDetectedAt,
      muteNotifications: row.muteNotifications === 1
    })
  }
  return map
}

/**
 * Slice 43 (v5): O(1) check for one Project's mute state. Used by
 * the idle detector's mute-check closure on each fire so the read is
 * always fresh (no caching). Returns `false` for unknown Projects so
 * notifications still flow for newly-discovered ones.
 */
export function isProjectMuted(
  db: Database.Database,
  encodedPath: string
): boolean {
  const row = db
    .prepare('SELECT mute_notifications FROM projects WHERE encoded_path = ?')
    .get(encodedPath) as { mute_notifications: number } | undefined
  return row?.mute_notifications === 1
}

/**
 * Look up just the Source Path for an encoded path. Returns null when
 * the Project hasn't been seen yet (renderer should never call into
 * dependent IPC before the sidebar list has hydrated, but we guard
 * anyway).
 */
export function getSourcePath(
  db: Database.Database,
  encodedPath: string
): string | null {
  const row = db
    .prepare('SELECT source_path AS sourcePath FROM projects WHERE encoded_path = ?')
    .get(encodedPath) as { sourcePath: string } | undefined
  return row?.sourcePath ?? null
}

/**
 * Persist detector output against a Project. `auto_name` is overwritten
 * because detection produces the canonical humanized form; `auto_subtitle`
 * is set even when `null` so a previously-detected subtitle is cleared if
 * the Project's canonical files have all gone away.
 */
export function upsertDetectedMetadata(
  db: Database.Database,
  encodedPath: string,
  metadata: DetectedMetadata,
  detectedAt: string
): void {
  db.prepare(
    `UPDATE projects
        SET auto_name = @auto_name,
            auto_subtitle = @auto_subtitle,
            last_metadata_detected_at = @detected_at
      WHERE encoded_path = @encoded_path`
  ).run({
    encoded_path: encodedPath,
    auto_name: metadata.autoName,
    auto_subtitle: metadata.autoSubtitle,
    detected_at: detectedAt
  })
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
    if (key === 'muteNotifications' && patch.muteNotifications !== undefined) {
      sets.push('mute_notifications = @mute_notifications')
      params.mute_notifications = patch.muteNotifications ? 1 : 0
    }
  }

  if (sets.length === 0) return

  db.prepare(
    `UPDATE projects SET ${sets.join(', ')} WHERE encoded_path = @encoded_path`
  ).run(params)
}
