import type Database from 'better-sqlite3'

/**
 * Minimal seam over Electron's `safeStorage` — letting tests inject a
 * fake backend keeps the SecretsVault Electron-free at the call sites
 * we need to cover. The production wiring in main passes the real
 * `safeStorage` module; tests pass a base64 stand-in.
 */
export interface EncryptionBackend {
  isEncryptionAvailable(): boolean
  encryptString(plaintext: string): Buffer
  decryptString(ciphertext: Buffer): string
}

export class SecretsVaultUnavailableError extends Error {
  constructor() {
    super('safeStorage encryption is unavailable on this system')
    this.name = 'SecretsVaultUnavailableError'
  }
}

/**
 * Round-trip a plaintext secret through the OS keychain (via Electron's
 * `safeStorage`) and persist the ciphertext as bytes in
 * `settings.value_blob`. Throws `SecretsVaultUnavailableError` when the
 * backend reports encryption isn't available — we refuse to fall back
 * to plaintext storage even silently.
 */
export function setSecret(
  db: Database.Database,
  backend: EncryptionBackend,
  key: string,
  plaintext: string
): void {
  if (!backend.isEncryptionAvailable()) {
    throw new SecretsVaultUnavailableError()
  }
  const ciphertext = backend.encryptString(plaintext)
  db.prepare(
    `INSERT INTO settings (key, value, value_blob, updated_at)
     VALUES (@key, NULL, @blob, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = NULL,
       value_blob = excluded.value_blob,
       updated_at = excluded.updated_at`
  ).run({ key, blob: ciphertext })
}

/**
 * Decrypt and return the stored plaintext, or `null` if no row exists.
 * Only the main process should ever see plaintext — the renderer reads
 * the masked form via `getMaskedSecret`.
 */
export function getSecret(
  db: Database.Database,
  backend: EncryptionBackend,
  key: string
): string | null {
  const row = db
    .prepare('SELECT value_blob FROM settings WHERE key = ?')
    .get(key) as { value_blob: Buffer | null } | undefined
  const blob = row?.value_blob
  if (!blob) return null
  if (!backend.isEncryptionAvailable()) {
    throw new SecretsVaultUnavailableError()
  }
  return backend.decryptString(blob)
}

/**
 * Renderer-safe view: returns the masked display string
 * (`first 7 + …•••• + last 4`) without leaking plaintext, or `null`
 * if nothing is stored. Anything shorter than 12 characters is
 * collapsed to bullets so we never display more than 4 trailing
 * chars of small inputs.
 */
export function getMaskedSecret(
  db: Database.Database,
  backend: EncryptionBackend,
  key: string
): string | null {
  const plaintext = getSecret(db, backend, key)
  if (plaintext === null) return null
  return maskSecret(plaintext)
}

export function clearSecret(db: Database.Database, key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key)
}

export function maskSecret(plaintext: string): string {
  if (plaintext.length < 12) return '••••' + plaintext.slice(-4)
  return plaintext.slice(0, 7) + '…••••' + plaintext.slice(-4)
}
