import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@main/db/migrations'
import {
  upsertDiscovered,
  readAugmentation,
  updateProject
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

    it('updates source_path, source_missing, and auto_name on re-upsert', () => {
      upsertDiscovered(db, [discovered('-x', '/old', 'OldName', false)])
      upsertDiscovered(db, [discovered('-x', '/new', 'NewName', true)])
      const row = db
        .prepare(
          'SELECT source_path, source_missing, auto_name FROM projects WHERE encoded_path = ?'
        )
        .get('-x') as { source_path: string; source_missing: number; auto_name: string }
      expect(row.source_path).toBe('/new')
      expect(row.source_missing).toBe(1)
      expect(row.auto_name).toBe('NewName')
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
    it('returns hidden=false by default for a freshly-inserted Project', () => {
      upsertDiscovered(db, [discovered('-fresh', '/fresh', 'Fresh')])
      const aug = readAugmentation(db)
      expect(aug.get('-fresh')).toEqual({ hidden: false })
    })

    it('reflects updates made via updateProject', () => {
      upsertDiscovered(db, [discovered('-h', '/h', 'H')])
      updateProject(db, '-h', { hidden: true })
      const aug = readAugmentation(db)
      expect(aug.get('-h')).toEqual({ hidden: true })
    })

    it('returns an empty map when no Projects exist', () => {
      const aug = readAugmentation(db)
      expect(aug.size).toBe(0)
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
