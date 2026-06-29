import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations, MIGRATIONS } from '@main/db/migrations'

describe('runMigrations', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('creates the _applied_migrations tracking table on first run', () => {
    runMigrations(db)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_applied_migrations'")
      .all()
    expect(tables).toHaveLength(1)
  })

  it('applies every bundled migration on a fresh database', () => {
    const result = runMigrations(db)
    expect(result.applied).toEqual(MIGRATIONS.map((m) => m.id))
  })

  it('records each applied migration in the tracking table', () => {
    runMigrations(db)
    const rows = db
      .prepare('SELECT id FROM _applied_migrations ORDER BY id')
      .all() as Array<{ id: string }>
    expect(rows.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id))
  })

  it('is idempotent — a second run applies nothing new', () => {
    runMigrations(db)
    const second = runMigrations(db)
    expect(second.applied).toEqual([])
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM _applied_migrations').get() as {
      n: number
    }
    expect(n).toBe(MIGRATIONS.length)
  })

  it('only applies migrations that are not already recorded', () => {
    const m1 = { id: 'test_a', sql: 'CREATE TABLE a (x INTEGER)' }
    const m2 = { id: 'test_b', sql: 'CREATE TABLE b (x INTEGER)' }
    runMigrations(db, [m1])
    const result = runMigrations(db, [m1, m2])
    expect(result.applied).toEqual(['test_b'])
  })

  it('rolls back if a migration fails (transactional)', () => {
    const broken = {
      id: 'broken',
      sql: 'CREATE TABLE ok (x INTEGER); INSERT INTO does_not_exist VALUES (1);'
    }
    expect(() => runMigrations(db, [broken])).toThrow()
    const rows = db.prepare('SELECT id FROM _applied_migrations').all() as Array<{ id: string }>
    expect(rows.map((r) => r.id)).not.toContain('broken')
    const okTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ok'")
      .all()
    expect(okTable).toHaveLength(0)
  })

  // Synthetic upgrade-cycle tests (Slice 30 / v3 internal hardening).
  // These exercise the data-preservation property of runMigrations:
  // applying new migrations on top of populated tables doesn't lose data.
  // Real cross-version migrations (e.g. v0.3.0 → v0.4.0) will extend this
  // pattern by adding one stage per future migration.
  describe('data preservation across migrations', () => {
    it('preserves a Project row inserted after a partial apply when later migrations run', () => {
      // Stage 1: apply only the first two migrations (meta + projects).
      runMigrations(db, MIGRATIONS.slice(0, 2))

      // Stage 2: insert representative data under that schema.
      db.prepare(
        `INSERT INTO projects (encoded_path, source_path, auto_name)
         VALUES (?, ?, ?)`
      ).run('-Users-foo-bar', '/Users/foo/bar', 'bar')

      // Stage 3: apply remaining migrations (settings + analyses).
      const result = runMigrations(db)
      expect(result.applied).toEqual(['0002_settings', '0003_analyses'])

      // Stage 4: the Project row is still there...
      const row = db
        .prepare('SELECT source_path, auto_name FROM projects WHERE encoded_path = ?')
        .get('-Users-foo-bar') as { source_path: string; auto_name: string } | undefined
      expect(row).toBeDefined()
      expect(row?.source_path).toBe('/Users/foo/bar')
      expect(row?.auto_name).toBe('bar')

      // ...and the new tables exist.
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('settings', 'analyses')"
        )
        .all() as Array<{ name: string }>
      expect(tables.map((t) => t.name).sort()).toEqual(['analyses', 'settings'])
    })

    it('preserves data inserted at each migration step when stepping through the chain', () => {
      // Apply migration 0000 (meta); record the schema_version row that the
      // migration itself inserted.
      runMigrations(db, MIGRATIONS.slice(0, 1))
      const seededVersion = db
        .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
        .get() as { value: string }
      expect(seededVersion.value).toBe('0000')

      // Apply migration 0001; insert a Project.
      runMigrations(db, MIGRATIONS.slice(0, 2))
      db.prepare(
        `INSERT INTO projects (encoded_path, source_path, auto_name)
         VALUES (?, ?, ?)`
      ).run('-step-project', '/step/project', 'project')

      // Apply migration 0002; insert a setting.
      runMigrations(db, MIGRATIONS.slice(0, 3))
      db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run(
        'ui.theme.preference',
        'dark'
      )

      // Apply migration 0003; insert an analysis pointing at the earlier
      // Project.
      runMigrations(db, MIGRATIONS)
      db.prepare(
        `INSERT INTO analyses (
           encoded_path, generated_at, status, provider, model,
           summary_md, next_steps_json, suggested_improvements_json
         ) VALUES (?, ?, 'ok', 'claude', 'claude-haiku-4-5', ?, ?, ?)`
      ).run(
        '-step-project',
        '2026-06-29T18:00:00Z',
        '# Summary',
        JSON.stringify([{ text: 'Next' }]),
        JSON.stringify([{ text: 'Improve' }])
      )

      // After the full chain has applied, every piece of data inserted
      // along the way is still queryable and joins cleanly.
      const meta = db
        .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
        .get() as { value: string }
      expect(meta.value).toBe('0000')

      const project = db
        .prepare('SELECT auto_name FROM projects WHERE encoded_path = ?')
        .get('-step-project') as { auto_name: string }
      expect(project.auto_name).toBe('project')

      const setting = db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get('ui.theme.preference') as { value: string }
      expect(setting.value).toBe('dark')

      const analysis = db
        .prepare(
          `SELECT a.status, p.auto_name
           FROM analyses a
           JOIN projects p ON p.encoded_path = a.encoded_path
           WHERE a.encoded_path = ?`
        )
        .get('-step-project') as { status: string; auto_name: string }
      expect(analysis.status).toBe('ok')
      expect(analysis.auto_name).toBe('project')

      // All four migration ids should be recorded.
      const applied = db
        .prepare('SELECT id FROM _applied_migrations ORDER BY id')
        .all() as Array<{ id: string }>
      expect(applied.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id))
    })
  })
})
