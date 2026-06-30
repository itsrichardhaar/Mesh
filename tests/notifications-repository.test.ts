import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@main/db/migrations'
import {
  clearAll,
  deleteOlderThan,
  insertNotification,
  listNotifications,
  markAllRead,
  markRead,
  unreadCount
} from '@main/notifications/repository'

const PROJECT_A = '-Users-rh-Desktop-A'
const PROJECT_B = '-Users-rh-Desktop-B'
const SESS_1 = 'sess-1111'
const SESS_2 = 'sess-2222'

describe('notifications repository — Slice 41', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
  })

  afterEach(() => {
    db.close()
  })

  function seed(input: {
    id: string
    createdAt: string
    encodedPath?: string
    sessionId?: string
    ptyId?: string | null
    kind?: string
    labelText?: string
  }): void {
    insertNotification(db, {
      id: input.id,
      createdAt: input.createdAt,
      encodedPath: input.encodedPath ?? PROJECT_A,
      sessionId: input.sessionId ?? SESS_1,
      ptyId: input.ptyId ?? 'pty-' + input.id,
      kind: (input.kind ?? 'idle') as 'idle',
      labelText: input.labelText ?? 'Agent is idle'
    })
  }

  it('inserts a row and round-trips via listNotifications', () => {
    insertNotification(db, {
      id: 'n1',
      createdAt: '2026-06-30T10:00:00.000Z',
      encodedPath: PROJECT_A,
      sessionId: SESS_1,
      ptyId: 'pty-1',
      kind: 'idle',
      labelText: 'Agent is idle'
    })
    const rows = listNotifications(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      id: 'n1',
      createdAt: '2026-06-30T10:00:00.000Z',
      encodedPath: PROJECT_A,
      sessionId: SESS_1,
      ptyId: 'pty-1',
      kind: 'idle',
      labelText: 'Agent is idle',
      readAt: null
    })
  })

  it('orders rows newest-first across different days', () => {
    seed({ id: 'old', createdAt: '2026-06-28T10:00:00.000Z' })
    seed({ id: 'newest', createdAt: '2026-06-30T10:00:00.000Z' })
    seed({ id: 'middle', createdAt: '2026-06-29T10:00:00.000Z' })
    const ids = listNotifications(db).map((n) => n.id)
    expect(ids).toEqual(['newest', 'middle', 'old'])
  })

  it('within the same day, unread surfaces before read', () => {
    seed({ id: 'a', createdAt: '2026-06-30T10:00:00.000Z' })
    seed({ id: 'b', createdAt: '2026-06-30T11:00:00.000Z' })
    seed({ id: 'c', createdAt: '2026-06-30T09:00:00.000Z' })
    // Mark `b` (the newest) as read — should drop below the two unread.
    markRead(db, 'b', '2026-06-30T11:30:00.000Z')
    const ids = listNotifications(db).map((n) => n.id)
    // Unread first (newest-first among them): a then c. Then read: b.
    expect(ids).toEqual(['a', 'c', 'b'])
  })

  it('filters list by encodedPath', () => {
    seed({ id: 'a', createdAt: '2026-06-30T10:00:00.000Z', encodedPath: PROJECT_A })
    seed({ id: 'b', createdAt: '2026-06-30T10:00:00.000Z', encodedPath: PROJECT_B })
    expect(listNotifications(db, { encodedPath: PROJECT_A }).map((n) => n.id)).toEqual(['a'])
    expect(listNotifications(db, { encodedPath: PROJECT_B }).map((n) => n.id)).toEqual(['b'])
  })

  it('honors limit', () => {
    for (let i = 0; i < 5; i++) {
      seed({ id: `n${i}`, createdAt: `2026-06-${20 + i}T10:00:00.000Z` })
    }
    const ids = listNotifications(db, { limit: 3 }).map((n) => n.id)
    expect(ids).toHaveLength(3)
    // Newest-first → n4, n3, n2
    expect(ids).toEqual(['n4', 'n3', 'n2'])
  })

  it('markRead updates only the targeted unread row; idempotent on a row already read', () => {
    seed({ id: 'a', createdAt: '2026-06-30T10:00:00.000Z' })
    const first = markRead(db, 'a', '2026-06-30T11:00:00.000Z')
    expect(first.updated).toEqual(['a'])
    const second = markRead(db, 'a', '2026-06-30T12:00:00.000Z')
    expect(second.updated).toEqual([])
    expect(listNotifications(db)[0]!.readAt).toBe('2026-06-30T11:00:00.000Z')
  })

  it('markRead on a missing id returns no updates', () => {
    const result = markRead(db, 'nope', '2026-06-30T11:00:00.000Z')
    expect(result.updated).toEqual([])
  })

  it('markAllRead({ sessionId }) only updates that session', () => {
    seed({ id: 'a', createdAt: '2026-06-30T10:00:00.000Z', sessionId: SESS_1 })
    seed({ id: 'b', createdAt: '2026-06-30T10:00:00.000Z', sessionId: SESS_2 })
    seed({ id: 'c', createdAt: '2026-06-30T10:00:00.000Z', sessionId: SESS_1 })
    const result = markAllRead(db, { sessionId: SESS_1 }, '2026-06-30T11:00:00.000Z')
    expect(result.updated.sort()).toEqual(['a', 'c'])
    // SESS_2 row is untouched.
    const sess2 = listNotifications(db).find((n) => n.id === 'b')
    expect(sess2?.readAt).toBeNull()
  })

  it('markAllRead({ encodedPath }) only updates that project', () => {
    seed({ id: 'a', createdAt: '2026-06-30T10:00:00.000Z', encodedPath: PROJECT_A })
    seed({ id: 'b', createdAt: '2026-06-30T10:00:00.000Z', encodedPath: PROJECT_B })
    const result = markAllRead(db, { encodedPath: PROJECT_A }, '2026-06-30T11:00:00.000Z')
    expect(result.updated).toEqual(['a'])
  })

  it('markAllRead with no scope updates everything', () => {
    seed({ id: 'a', createdAt: '2026-06-30T10:00:00.000Z' })
    seed({ id: 'b', createdAt: '2026-06-30T10:00:00.000Z' })
    const result = markAllRead(db, {}, '2026-06-30T11:00:00.000Z')
    expect(result.updated.sort()).toEqual(['a', 'b'])
  })

  it('clearAll deletes scoped rows', () => {
    seed({ id: 'a', createdAt: '2026-06-30T10:00:00.000Z', encodedPath: PROJECT_A })
    seed({ id: 'b', createdAt: '2026-06-30T10:00:00.000Z', encodedPath: PROJECT_B })
    const result = clearAll(db, { encodedPath: PROJECT_A })
    expect(result.cleared).toBe(1)
    expect(listNotifications(db).map((n) => n.id)).toEqual(['b'])
  })

  it('clearAll with no scope deletes everything', () => {
    seed({ id: 'a', createdAt: '2026-06-30T10:00:00.000Z' })
    seed({ id: 'b', createdAt: '2026-06-30T10:00:00.000Z' })
    const result = clearAll(db, {})
    expect(result.cleared).toBe(2)
    expect(listNotifications(db)).toEqual([])
  })

  it('deleteOlderThan respects the cutoff strictly', () => {
    seed({ id: 'old', createdAt: '2026-06-20T10:00:00.000Z' })
    seed({ id: 'boundary', createdAt: '2026-06-23T10:00:00.000Z' })
    seed({ id: 'fresh', createdAt: '2026-06-25T10:00:00.000Z' })
    // Cutoff equals "boundary" exactly — strictly older means only "old" goes.
    const result = deleteOlderThan(db, '2026-06-23T10:00:00.000Z')
    expect(result.cleared).toBe(1)
    expect(listNotifications(db).map((n) => n.id).sort()).toEqual(['boundary', 'fresh'])
  })

  it('unreadCount reflects mark/clear operations', () => {
    seed({ id: 'a', createdAt: '2026-06-30T10:00:00.000Z' })
    seed({ id: 'b', createdAt: '2026-06-30T10:00:00.000Z' })
    expect(unreadCount(db)).toBe(2)
    markRead(db, 'a', '2026-06-30T11:00:00.000Z')
    expect(unreadCount(db)).toBe(1)
    markAllRead(db, {}, '2026-06-30T11:00:00.000Z')
    expect(unreadCount(db)).toBe(0)
  })
})
