import type Database from 'better-sqlite3'
import { isProviderId, type ProviderId } from '@shared/types'

/** Stable SQLite key for the user's Active Provider selection (v4 Slice 36). */
export const ACTIVE_PROVIDER_KEY = 'active_provider'

/** Slice 43 (v5): global notifications-mute toggle. Stored as `'1'` / `'0'`. */
export const NOTIFICATIONS_GLOBAL_MUTE_KEY = 'notifications_global_mute'

/** v7 / Slice 51: opt-in for networked Claude Quota (ADR-0011). Stored as `'1'` / `'0'`. */
export const QUOTA_ENABLED_KEY = 'quota_enabled'

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

/**
 * Read the user's Active Provider. Defaults to `'claude'` when no row
 * exists (backward-compatible with v0.3.x installs) or when the stored
 * value is corrupt (not a known `ProviderId`). Slice 36.
 */
export function getActiveProvider(db: Database.Database): ProviderId {
  const stored = getSetting(db, ACTIVE_PROVIDER_KEY)
  return isProviderId(stored) ? stored : 'claude'
}

/**
 * Write the user's Active Provider. Validates the value is a known
 * `ProviderId` at the boundary; out-of-shape values throw rather than
 * silently corrupting the setting. Slice 36.
 */
export function setActiveProvider(
  db: Database.Database,
  provider: ProviderId
): void {
  if (!isProviderId(provider)) {
    throw new Error(
      `setActiveProvider: provider must be a known ProviderId (got ${String(provider)})`
    )
  }
  setSetting(db, ACTIVE_PROVIDER_KEY, provider)
}

/**
 * v5 / Slice 43: global notifications-mute toggle. Stored as the
 * literal string `'1'` (muted) or `'0'` (active). Defaults to `false`
 * (notifications fire) when no row exists or when the stored value is
 * corrupt — same backward-compat principle as `getActiveProvider`.
 */
export function getGlobalNotificationsMute(db: Database.Database): boolean {
  return getSetting(db, NOTIFICATIONS_GLOBAL_MUTE_KEY) === '1'
}

export function setGlobalNotificationsMute(db: Database.Database, value: boolean): void {
  setSetting(db, NOTIFICATIONS_GLOBAL_MUTE_KEY, value ? '1' : '0')
}

/**
 * v7 / Slice 51: whether networked Claude Quota is enabled. Defaults to
 * `false` (off) when no row exists — the outbound call and the
 * credential read happen only after the user opts in (ADR-0011).
 */
export function getQuotaEnabled(db: Database.Database): boolean {
  return getSetting(db, QUOTA_ENABLED_KEY) === '1'
}

export function setQuotaEnabled(db: Database.Database, value: boolean): void {
  setSetting(db, QUOTA_ENABLED_KEY, value ? '1' : '0')
}
