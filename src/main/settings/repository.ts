import type Database from 'better-sqlite3'

/**
 * Read a single setting's string value, or `null` if no row exists for
 * the key. Encrypted secrets (Slice 7) live in `value_blob` and have
 * their own reader — this function only returns string `value`s.
 */
export function getSetting(db: Database.Database, key: string): string | null {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string | null } | undefined
  return row?.value ?? null
}

/**
 * Insert-or-overwrite a setting's string value. Clears any sibling
 * `value_blob` (a key flips between string-setting and secret-setting
 * only via an explicit reset, never accidentally).
 */
export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, value_blob, updated_at)
     VALUES (@key, @value, NULL, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       value_blob = NULL,
       updated_at = excluded.updated_at`
  ).run({ key, value })
}
