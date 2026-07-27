import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@main/db/migrations'
import {
  ACTIVE_PROVIDER_KEY,
  NOTIFICATIONS_GLOBAL_MUTE_KEY,
  getActiveProvider,
  getGlobalNotificationsMute,
  getKindToastEnabled,
  getSetting,
  setActiveProvider,
  setGlobalNotificationsMute,
  setKindToastEnabled,
  setSetting
} from '@main/settings/repository'

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

  it('per-kind toast preference defaults to enabled and round-trips', () => {
    // Absent row → enabled (v5 baseline preserved until opt-out).
    expect(getKindToastEnabled(db, 'approval')).toBe(true)
    expect(getKindToastEnabled(db, 'complete')).toBe(true)

    setKindToastEnabled(db, 'complete', false)
    expect(getKindToastEnabled(db, 'complete')).toBe(false)
    // Other kinds are independent.
    expect(getKindToastEnabled(db, 'approval')).toBe(true)

    setKindToastEnabled(db, 'complete', true)
    expect(getKindToastEnabled(db, 'complete')).toBe(true)
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

  /**
   * Slice 36 — Active Provider switching. Repository-level guarantees:
   * default when absent, round-trip persistence, type validation at
   * the boundary. The IPC layer wraps these; renderer subscribers see
   * the `settings:active-provider-changed` event channel.
   */
  describe('active_provider (Slice 36)', () => {
    it('defaults to claude when no row exists (v0.3.x backward compat)', () => {
      expect(getActiveProvider(db)).toBe('claude')
    })

    it('round-trips a written value', () => {
      setActiveProvider(db, 'openai')
      expect(getActiveProvider(db)).toBe('openai')
    })

    it('writes under the stable ACTIVE_PROVIDER_KEY', () => {
      setActiveProvider(db, 'openai')
      expect(getSetting(db, ACTIVE_PROVIDER_KEY)).toBe('openai')
    })

    it('falls back to claude when the stored value is corrupt', () => {
      // Simulate a corrupted row that bypasses the setter's guard.
      setSetting(db, ACTIVE_PROVIDER_KEY, 'gpt-99-mythical')
      expect(getActiveProvider(db)).toBe('claude')
    })

    it('rejects out-of-shape values at the setter boundary', () => {
      expect(() => setActiveProvider(db, 'not-a-provider' as never)).toThrow(
        /must be a known ProviderId/
      )
      expect(() => setActiveProvider(db, 42 as never)).toThrow(/must be a known ProviderId/)
      expect(() => setActiveProvider(db, null as never)).toThrow(/must be a known ProviderId/)
    })

    it('overwrites on second set', () => {
      setActiveProvider(db, 'openai')
      setActiveProvider(db, 'claude')
      expect(getActiveProvider(db)).toBe('claude')
    })
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

  describe('global notifications mute (Slice 43)', () => {
    it('defaults to false when no row exists', () => {
      expect(getGlobalNotificationsMute(db)).toBe(false)
    })

    it('round-trips a true value', () => {
      setGlobalNotificationsMute(db, true)
      expect(getGlobalNotificationsMute(db)).toBe(true)
    })

    it('round-trips a false value', () => {
      setGlobalNotificationsMute(db, true)
      setGlobalNotificationsMute(db, false)
      expect(getGlobalNotificationsMute(db)).toBe(false)
    })

    it('uses a stable settings key', () => {
      setGlobalNotificationsMute(db, true)
      expect(getSetting(db, NOTIFICATIONS_GLOBAL_MUTE_KEY)).toBe('1')
    })

    it('falls back to false on any non-1 stored value', () => {
      setSetting(db, NOTIFICATIONS_GLOBAL_MUTE_KEY, 'maybe')
      expect(getGlobalNotificationsMute(db)).toBe(false)
    })

    it('overwrites on second set', () => {
      setGlobalNotificationsMute(db, true)
      setGlobalNotificationsMute(db, true)
      setGlobalNotificationsMute(db, false)
      expect(getGlobalNotificationsMute(db)).toBe(false)
    })
  })
})
