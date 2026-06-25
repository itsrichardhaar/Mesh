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
})
