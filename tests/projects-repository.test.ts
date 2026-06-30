import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@main/db/migrations'
import {
  upsertDiscovered,
  readAugmentation,
  updateProject,
  upsertDetectedMetadata,
  isProjectMuted
} from '@main/projects/repository'
import type { DiscoveredProject } from '@main/projects/enumerator'

describe('projects repository', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  describe('upsertDiscovered', () => {
    it('inserts a row for each new Project', () => {
      upsertDiscovered(db, [discovered('-a', '/a', 'a'), discovered('-b', '/b', 'b')])
      const rows = db.prepare('SELECT encoded_path FROM projects ORDER BY encoded_path').all() as Array<{
        encoded_path: string
      }>
      expect(rows.map((r) => r.encoded_path)).toEqual(['-a', '-b'])
    })

    it('updates source_path and source_missing on re-upsert', () => {
      upsertDiscovered(db, [discovered('-x', '/old', 'OldName', false)])
      upsertDiscovered(db, [discovered('-x', '/new', 'NewName', true)])
      const row = db
        .prepare(
          'SELECT source_path, source_missing FROM projects WHERE encoded_path = ?'
        )
        .get('-x') as { source_path: string; source_missing: number }
      expect(row.source_path).toBe('/new')
      expect(row.source_missing).toBe(1)
    })

    it('preserves a detector-written auto_name across re-upsert (auto_name is detector-owned after first detection)', () => {
      upsertDiscovered(db, [discovered('-a', '/AI-OS-Dashboard', 'AI-OS-Dashboard')])
      upsertDetectedMetadata(
        db,
        '-a',
        { autoName: 'AI OS Dashboard', autoSubtitle: 'Next.js' },
        '2026-06-24T00:00:00.000Z'
      )
      upsertDiscovered(db, [discovered('-a', '/AI-OS-Dashboard', 'AI-OS-Dashboard')])
      const row = db
        .prepare('SELECT auto_name FROM projects WHERE encoded_path = ?')
        .get('-a') as { auto_name: string }
      expect(row.auto_name).toBe('AI OS Dashboard')
    })

    it('preserves hidden across re-upsert (does not overwrite augmentation columns)', () => {
      upsertDiscovered(db, [discovered('-keep', '/keep', 'Keep')])
      updateProject(db, '-keep', { hidden: true })
      upsertDiscovered(db, [discovered('-keep', '/keep', 'Keep')])
      const row = db
        .prepare('SELECT hidden FROM projects WHERE encoded_path = ?')
        .get('-keep') as { hidden: number }
      expect(row.hidden).toBe(1)
    })
  })

  describe('readAugmentation', () => {
    it('returns base augmentation for a freshly-inserted Project (subtitle null, autoName from upsert)', () => {
      upsertDiscovered(db, [discovered('-fresh', '/fresh', 'Fresh')])
      const aug = readAugmentation(db)
      expect(aug.get('-fresh')).toEqual({
        hidden: false,
        autoName: 'Fresh',
        autoSubtitle: null,
        lastMetadataDetectedAt: null,
        muteNotifications: false
      })
    })

    it('reflects updates made via updateProject', () => {
      upsertDiscovered(db, [discovered('-h', '/h', 'H')])
      updateProject(db, '-h', { hidden: true })
      const aug = readAugmentation(db)
      expect(aug.get('-h')?.hidden).toBe(true)
    })

    it('returns an empty map when no Projects exist', () => {
      const aug = readAugmentation(db)
      expect(aug.size).toBe(0)
    })
  })

  describe('upsertDetectedMetadata', () => {
    it('overwrites auto_name with the humanized form and writes auto_subtitle', () => {
      upsertDiscovered(db, [discovered('-ai', '/AI-OS-Dashboard', 'AI-OS-Dashboard')])
      upsertDetectedMetadata(
        db,
        '-ai',
        { autoName: 'AI OS Dashboard', autoSubtitle: 'Next.js' },
        '2026-06-24T00:00:00.000Z'
      )
      const aug = readAugmentation(db)
      expect(aug.get('-ai')).toEqual({
        hidden: false,
        autoName: 'AI OS Dashboard',
        autoSubtitle: 'Next.js',
        lastMetadataDetectedAt: '2026-06-24T00:00:00.000Z',
        muteNotifications: false
      })
    })

    it('clears a previously-detected subtitle when the new detection returns null', () => {
      upsertDiscovered(db, [discovered('-x', '/x', 'X')])
      upsertDetectedMetadata(
        db,
        '-x',
        { autoName: 'X', autoSubtitle: 'Rust' },
        '2026-06-01T00:00:00.000Z'
      )
      upsertDetectedMetadata(
        db,
        '-x',
        { autoName: 'X', autoSubtitle: null },
        '2026-06-24T00:00:00.000Z'
      )
      expect(readAugmentation(db).get('-x')?.autoSubtitle).toBeNull()
    })

    it('preserves auto_subtitle across an upsertDiscovered call (filesystem-owned vs detector-owned)', () => {
      upsertDiscovered(db, [discovered('-p', '/p', 'P')])
      upsertDetectedMetadata(
        db,
        '-p',
        { autoName: 'P', autoSubtitle: 'Go' },
        '2026-06-01T00:00:00.000Z'
      )
      upsertDiscovered(db, [discovered('-p', '/p', 'P')])
      const aug = readAugmentation(db).get('-p')
      expect(aug?.autoSubtitle).toBe('Go')
      expect(aug?.lastMetadataDetectedAt).toBe('2026-06-01T00:00:00.000Z')
    })
  })

  describe('updateProject', () => {
    it('updates the hidden flag', () => {
      upsertDiscovered(db, [discovered('-u', '/u', 'U')])
      updateProject(db, '-u', { hidden: true })
      const row = db
        .prepare('SELECT hidden FROM projects WHERE encoded_path = ?')
        .get('-u') as { hidden: number }
      expect(row.hidden).toBe(1)
    })

    it('throws on unknown patch keys', () => {
      upsertDiscovered(db, [discovered('-u', '/u', 'U')])
      expect(() =>
        // @ts-expect-error — intentionally invalid for test
        updateProject(db, '-u', { evil_field: 1 })
      ).toThrow(/unknown patch key/i)
    })

    it('is a no-op when the patch is empty', () => {
      upsertDiscovered(db, [discovered('-u', '/u', 'U')])
      updateProject(db, '-u', {})
      const row = db
        .prepare('SELECT hidden FROM projects WHERE encoded_path = ?')
        .get('-u') as { hidden: number }
      expect(row.hidden).toBe(0)
    })

    it('does nothing when the encodedPath does not exist (no error, no insert)', () => {
      updateProject(db, '-ghost', { hidden: true })
      const row = db
        .prepare('SELECT encoded_path FROM projects WHERE encoded_path = ?')
        .get('-ghost')
      expect(row).toBeUndefined()
    })

    it('updates the muteNotifications flag (Slice 43)', () => {
      upsertDiscovered(db, [discovered('-m', '/m', 'M')])
      updateProject(db, '-m', { muteNotifications: true })
      const row = db
        .prepare('SELECT mute_notifications FROM projects WHERE encoded_path = ?')
        .get('-m') as { mute_notifications: number }
      expect(row.mute_notifications).toBe(1)
    })

    it('hidden and muteNotifications are orthogonal in a single patch (Slice 43)', () => {
      upsertDiscovered(db, [discovered('-mh', '/mh', 'MH')])
      updateProject(db, '-mh', { hidden: true, muteNotifications: true })
      const row = db
        .prepare('SELECT hidden, mute_notifications FROM projects WHERE encoded_path = ?')
        .get('-mh') as { hidden: number; mute_notifications: number }
      expect(row.hidden).toBe(1)
      expect(row.mute_notifications).toBe(1)
    })
  })

  describe('isProjectMuted (Slice 43)', () => {
    it('returns false for unknown encodedPath', () => {
      expect(isProjectMuted(db, '-never')).toBe(false)
    })

    it('returns false by default for a freshly-inserted Project', () => {
      upsertDiscovered(db, [discovered('-fresh', '/fresh', 'Fresh')])
      expect(isProjectMuted(db, '-fresh')).toBe(false)
    })

    it('returns true after setting muteNotifications via updateProject', () => {
      upsertDiscovered(db, [discovered('-m', '/m', 'M')])
      updateProject(db, '-m', { muteNotifications: true })
      expect(isProjectMuted(db, '-m')).toBe(true)
      updateProject(db, '-m', { muteNotifications: false })
      expect(isProjectMuted(db, '-m')).toBe(false)
    })
  })
})

function discovered(
  encodedPath: string,
  sourcePath: string,
  name: string,
  sourceMissing = false
): DiscoveredProject {
  return {
    encodedPath,
    sourcePath,
    name,
    activity: new Date().toISOString(),
    sourceMissing
  }
}
