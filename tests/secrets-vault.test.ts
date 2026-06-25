import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@main/db/migrations'
import {
  clearSecret,
  EncryptionBackend,
  getMaskedSecret,
  getSecret,
  maskSecret,
  SecretsVaultUnavailableError,
  setSecret
} from '@main/secrets/vault'

/**
 * Identity stand-in for Electron's safeStorage so the tests can run in
 * vitest without spinning up a real OS keychain. The bytes that come
 * out of `encryptString` are opaque to SecretsVault — it only cares
 * that `decryptString(encryptString(s)) === s`, which an identity
 * encoder satisfies trivially.
 */
function fakeBackend(available = true): EncryptionBackend {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8')
  }
}

describe('SecretsVault', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  it('round-trips a plaintext secret through the backend', () => {
    const backend = fakeBackend()
    setSecret(db, backend, 'anthropic', 'sk-ant-1234567890abcdef1234')
    expect(getSecret(db, backend, 'anthropic')).toBe('sk-ant-1234567890abcdef1234')
  })

  it('returns null for an unset key', () => {
    expect(getSecret(db, fakeBackend(), 'never-set')).toBeNull()
  })

  it('overwrites an existing secret on second set', () => {
    const backend = fakeBackend()
    setSecret(db, backend, 'anthropic', 'sk-ant-original-key-1234')
    setSecret(db, backend, 'anthropic', 'sk-ant-replacement-key-5678')
    expect(getSecret(db, backend, 'anthropic')).toBe('sk-ant-replacement-key-5678')
  })

  it('clears the stored value column when persisting a secret over an existing string setting', () => {
    // Stash a plain `value` first, then overwrite with a secret.
    db.prepare(
      `INSERT INTO settings (key, value, value_blob) VALUES (?, ?, NULL)`
    ).run('hybrid', 'plain-string')
    setSecret(db, fakeBackend(), 'hybrid', 'sk-ant-secret-now-1234')
    const row = db
      .prepare('SELECT value, value_blob FROM settings WHERE key = ?')
      .get('hybrid') as { value: string | null; value_blob: Buffer | null }
    expect(row.value).toBeNull()
    expect(row.value_blob).not.toBeNull()
  })

  it('refuses to save when the backend reports encryption is unavailable', () => {
    expect(() => setSecret(db, fakeBackend(false), 'anthropic', 'sk-ant-anything')).toThrow(
      SecretsVaultUnavailableError
    )
  })

  it('does not insert a row when set is refused', () => {
    try {
      setSecret(db, fakeBackend(false), 'anthropic', 'sk-ant-anything')
    } catch {
      // expected
    }
    expect(getSecret(db, fakeBackend(), 'anthropic')).toBeNull()
  })

  it('refuses to read when the backend reports encryption is unavailable AND a blob exists', () => {
    const backend = fakeBackend()
    setSecret(db, backend, 'anthropic', 'sk-ant-stored')
    expect(() => getSecret(db, fakeBackend(false), 'anthropic')).toThrow(
      SecretsVaultUnavailableError
    )
  })

  it('returns null for unread keys even when encryption is unavailable (no decrypt attempted)', () => {
    expect(getSecret(db, fakeBackend(false), 'never-set')).toBeNull()
  })

  it('clearSecret removes the row entirely', () => {
    const backend = fakeBackend()
    setSecret(db, backend, 'anthropic', 'sk-ant-stored')
    clearSecret(db, 'anthropic')
    expect(getSecret(db, backend, 'anthropic')).toBeNull()
    const count = (
      db.prepare('SELECT COUNT(*) AS n FROM settings WHERE key = ?').get('anthropic') as {
        n: number
      }
    ).n
    expect(count).toBe(0)
  })

  it('getMaskedSecret returns the masked form, never the plaintext', () => {
    const backend = fakeBackend()
    setSecret(db, backend, 'anthropic', 'sk-ant-1234567890ABCDEFGHIJ')
    expect(getMaskedSecret(db, backend, 'anthropic')).toBe('sk-ant-…••••GHIJ')
  })

  it('getMaskedSecret returns null when no secret is stored', () => {
    expect(getMaskedSecret(db, fakeBackend(), 'anthropic')).toBeNull()
  })

  describe('maskSecret', () => {
    it('uses first-7 + …•••• + last-4 for typical Anthropic keys', () => {
      expect(maskSecret('sk-ant-1234567890abcdef1234XYZQ')).toBe('sk-ant-…••••XYZQ')
    })

    it('collapses very short inputs to bullets + last 4', () => {
      expect(maskSecret('short')).toBe('••••hort')
    })
  })
})
