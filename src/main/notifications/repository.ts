import type Database from 'better-sqlite3'
import type { Notification, NotificationKind } from '@shared/types'

/**
 * SQL boundary over the `notifications` table (Slice 41, v5). Pure
 * read/write; no side effects beyond DB. The idle detector inserts;
 * the IPC handlers list / mark / clear; the boot-time retention sweep
 * deletes old rows.
 */

interface NotificationRow {
  id: string
  created_at: string
  encoded_path: string
  session_id: string
  pty_id: string | null
  kind: string
  label_text: string
  read_at: string | null
}

function fromRow(row: NotificationRow): Notification {
  return {
    id: row.id,
    createdAt: row.created_at,
    encodedPath: row.encoded_path,
    sessionId: row.session_id,
    ptyId: row.pty_id,
    kind: row.kind as NotificationKind,
    labelText: row.label_text,
    readAt: row.read_at
  }
}

export interface InsertNotificationInput {
  id: string
  createdAt: string
  encodedPath: string
  sessionId: string
  ptyId: string | null
  kind: NotificationKind
  labelText: string
}

export function insertNotification(
  db: Database.Database,
  input: InsertNotificationInput
): Notification {
  db.prepare(
    `INSERT INTO notifications
       (id, created_at, encoded_path, session_id, pty_id, kind, label_text, read_at)
     VALUES (@id, @createdAt, @encodedPath, @sessionId, @ptyId, @kind, @labelText, NULL)`
  ).run(input)
  return {
    ...input,
    readAt: null
  }
}

/**
 * Newest-first list. Within the same calendar day (UTC, matching the
 * stored ISO 8601 strings), unread rows surface before read rows so the
 * dropdown opens to actionable items first.
 */
export function listNotifications(
  db: Database.Database,
  opts: { encodedPath?: string; limit?: number } = {}
): Notification[] {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}
  if (opts.encodedPath !== undefined) {
    conditions.push('encoded_path = @encodedPath')
    params.encodedPath = opts.encodedPath
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = typeof opts.limit === 'number' && opts.limit > 0 ? `LIMIT ${Math.floor(opts.limit)}` : ''
  // Day key derived from the ISO string's leading 10 chars (YYYY-MM-DD).
  // Sort: day descending (newest day first), then unread before read
  // (NULL read_at first via `read_at IS NOT NULL`), then created_at
  // descending so newer items lead within each (day, read-state) bucket.
  const rows = db
    .prepare(
      `SELECT id, created_at, encoded_path, session_id, pty_id, kind, label_text, read_at
       FROM notifications
       ${where}
       ORDER BY substr(created_at, 1, 10) DESC,
                (read_at IS NOT NULL) ASC,
                created_at DESC
       ${limit}`
    )
    .all(params) as NotificationRow[]
  return rows.map(fromRow)
}

export function markRead(
  db: Database.Database,
  id: string,
  atIso: string
): { updated: string[] } {
  const row = db
    .prepare(
      `UPDATE notifications
       SET read_at = @atIso
       WHERE id = @id AND read_at IS NULL
       RETURNING id`
    )
    .get({ id, atIso }) as { id: string } | undefined
  return { updated: row ? [row.id] : [] }
}

export function markAllRead(
  db: Database.Database,
  opts: { encodedPath?: string; sessionId?: string },
  atIso: string
): { updated: string[] } {
  const conditions: string[] = ['read_at IS NULL']
  const params: Record<string, unknown> = { atIso }
  if (opts.encodedPath !== undefined) {
    conditions.push('encoded_path = @encodedPath')
    params.encodedPath = opts.encodedPath
  }
  if (opts.sessionId !== undefined) {
    conditions.push('session_id = @sessionId')
    params.sessionId = opts.sessionId
  }
  const rows = db
    .prepare(
      `UPDATE notifications
       SET read_at = @atIso
       WHERE ${conditions.join(' AND ')}
       RETURNING id`
    )
    .all(params) as Array<{ id: string }>
  return { updated: rows.map((r) => r.id) }
}

export function clearAll(
  db: Database.Database,
  opts: { encodedPath?: string }
): { cleared: number } {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}
  if (opts.encodedPath !== undefined) {
    conditions.push('encoded_path = @encodedPath')
    params.encodedPath = opts.encodedPath
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const info = db.prepare(`DELETE FROM notifications ${where}`).run(params)
  return { cleared: info.changes }
}

/**
 * 7-day retention sweep (called from boot). Rows whose `created_at` is
 * strictly older than `cutoffIso` are removed. The caller computes the
 * cutoff so tests can pin it; production code passes `now - 7 days`.
 */
export function deleteOlderThan(
  db: Database.Database,
  cutoffIso: string
): { cleared: number } {
  const info = db
    .prepare('DELETE FROM notifications WHERE created_at < ?')
    .run(cutoffIso)
  return { cleared: info.changes }
}

export function unreadCount(db: Database.Database): number {
  const row = db
    .prepare('SELECT COUNT(*) as n FROM notifications WHERE read_at IS NULL')
    .get() as { n: number }
  return row.n
}
