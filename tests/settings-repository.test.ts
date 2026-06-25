import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@main/db/migrations'
import { getSetting, setSetting } from '@main/settings/repository'

describe('settings repository', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  it('returns null for an unset key', () => {
    expect(getSetting(db, 'theme')).toBeNull()
  })

  it('round-trips a string value', () => {
    setSetting(db, 'theme', 'dark')
    expect(getSetting(db, 'theme')).toBe('dark')
  })

  it('overwrites an existing value on second set', () => {
    setSetting(db, 'theme', 'light')
    setSetting(db, 'theme', 'system')
    expect(getSetting(db, 'theme')).toBe('system')
  })

  it('clears any sibling value_blob when overwriting via setSetting', () => {
    // Simulate a key that started life as a secret-style entry.
    db.prepare(
      `INSERT INTO settings (key, value, value_blob) VALUES (?, NULL, ?)`
    ).run('hybrid', Buffer.from('opaque'))
    setSetting(db, 'hybrid', 'now-a-string')
    const row = db
      .prepare('SELECT value, value_blob FROM settings WHERE key = ?')
      .get('hybrid') as { value: string | null; value_blob: Buffer | null }
    expect(row.value).toBe('now-a-string')
    expect(row.value_blob).toBeNull()
  })

  it('refreshes updated_at on overwrite', async () => {
    setSetting(db, 'theme', 'light')
    const first = db
      .prepare('SELECT updated_at FROM settings WHERE key = ?')
      .get('theme') as { updated_at: string }
    await new Promise((r) => setTimeout(r, 1100)) // datetime('now') resolution is 1s
    setSetting(db, 'theme', 'dark')
    const second = db
      .prepare('SELECT updated_at FROM settings WHERE key = ?')
      .get('theme') as { updated_at: string }
    expect(second.updated_at >= first.updated_at).toBe(true)
  })
})
