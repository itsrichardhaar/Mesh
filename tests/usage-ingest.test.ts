import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { runMigrations } from '@main/db/migrations'
import { tailParse, ingestProject, sweepAll } from '@main/usage/ingest'
import { usageEventCount } from '@main/usage/repository'

let seq = 0
function line(overrides: Record<string, unknown> = {}): string {
  seq += 1
  return JSON.stringify({
    type: 'assistant',
    uuid: `evt-${seq}`,
    sessionId: 'sess',
    timestamp: '2026-07-13T12:00:00.000Z',
    message: { model: 'claude-opus-4-8', usage: { input_tokens: 1, output_tokens: 2 } },
    ...overrides
  })
}

const CTX = { encodedPath: '-p', sessionId: 'sess', sourceFile: '/p/sess.jsonl' }
const NOW = (): string => '2026-07-13T12:00:00.000Z'

describe('tailParse', () => {
  it('parses all complete lines on a first pass and advances the cursor', () => {
    const buf = Buffer.from(`${line()}\n${JSON.stringify({ type: 'user' })}\n${line()}\n`, 'utf8')
    const { events, cursor } = tailParse(buf, null, CTX)
    expect(events).toHaveLength(2) // the user line yields nothing
    expect(cursor.byteOffset).toBe(buf.length)
    expect(cursor.lineCount).toBe(3)
  })

  it('consumes only appended lines on a subsequent pass', () => {
    const first = Buffer.from(`${line()}\n`, 'utf8')
    const pass1 = tailParse(first, null, CTX)
    expect(pass1.events).toHaveLength(1)

    const grown = Buffer.concat([first, Buffer.from(`${line()}\n`, 'utf8')])
    const pass2 = tailParse(grown, pass1.cursor, CTX)
    expect(pass2.events).toHaveLength(1)
    expect(pass2.cursor.byteOffset).toBe(grown.length)
    expect(pass2.cursor.lineCount).toBe(2)
    expect(pass2.events[0]!.sourceLine).toBe(2)
  })

  it('holds a half-written trailing line until its newline arrives', () => {
    const partial = Buffer.from(`${line()}\n{"type":"assistant","uuid":"evt-x"`, 'utf8')
    const pass1 = tailParse(partial, null, CTX)
    expect(pass1.events).toHaveLength(1) // only the complete first line
    const completedLine = line({ uuid: 'evt-x' })
    const whole = Buffer.from(`${line()}\n${completedLine}\n`, 'utf8')
    // Simulate the file being rewritten with both lines complete.
    const pass2 = tailParse(whole, pass1.cursor, CTX)
    expect(pass2.events.length).toBeGreaterThanOrEqual(1)
  })

  it('resets and re-parses when the file shrank below the cursor', () => {
    const buf = Buffer.from(`${line()}\n`, 'utf8')
    const staleCursor = { byteOffset: 9999, lineCount: 50 }
    const { events, cursor } = tailParse(buf, staleCursor, CTX)
    expect(events).toHaveLength(1)
    expect(cursor.byteOffset).toBe(buf.length)
    expect(cursor.lineCount).toBe(1)
  })

  it('returns nothing when there is no complete new line', () => {
    const buf = Buffer.from('no newline yet', 'utf8')
    const { events, cursor } = tailParse(buf, null, CTX)
    expect(events).toHaveLength(0)
    expect(cursor).toEqual({ byteOffset: 0, lineCount: 0 })
  })
})

describe('sweep over a projects directory', () => {
  let db: Database.Database
  let root: string

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    root = mkdtempSync(join(tmpdir(), 'mesh-usage-'))
    mkdirSync(join(root, '-proj-a'))
    mkdirSync(join(root, '-proj-b'))
    writeFileSync(join(root, '-proj-a', 's1.jsonl'), `${line()}\n${line()}\n`)
    writeFileSync(join(root, '-proj-b', 's2.jsonl'), `${line()}\n`)
  })

  afterEach(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('sweeps all Projects, then is idempotent on re-sweep', () => {
    expect(sweepAll(db, root, NOW)).toBe(3)
    expect(usageEventCount(db)).toBe(3)
    expect(sweepAll(db, root, NOW)).toBe(0) // nothing new
    expect(usageEventCount(db)).toBe(3)
  })

  it('tail-ingests only appended turns when a session grows', () => {
    sweepAll(db, root, NOW)
    appendFileSync(join(root, '-proj-a', 's1.jsonl'), `${line()}\n`)
    expect(ingestProject(db, root, '-proj-a', NOW)).toBe(1)
    expect(usageEventCount(db)).toBe(4)
  })

  it('attributes events to their containing folder (Encoded Path), not cwd', () => {
    sweepAll(db, root, NOW)
    const rows = db
      .prepare('SELECT DISTINCT encoded_path FROM usage_events ORDER BY encoded_path')
      .all() as Array<{ encoded_path: string }>
    expect(rows.map((r) => r.encoded_path)).toEqual(['-proj-a', '-proj-b'])
  })
})
