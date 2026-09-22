import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import {
  NoMistakesStateReader,
  readRepoWorkingPaths,
  readRunEnrichment
} from '@main/gate/no-mistakes-state'

/**
 * The ring-fenced read of no-mistakes' `state.sqlite` (ADR-0014). Every test
 * runs against an isolated temp DB; the reader must degrade to an empty map on
 * any failure and never throw.
 */
describe('readRepoWorkingPaths', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'mesh-state-'))
  })
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function seed(rows: Array<[string, string]>, schema?: string): string {
    const p = join(tmpRoot, 'state.sqlite')
    const db = new Database(p)
    db.exec(
      schema ??
        'CREATE TABLE repos (id TEXT PRIMARY KEY, working_path TEXT NOT NULL, upstream_url TEXT)'
    )
    if (!schema) {
      const ins = db.prepare('INSERT INTO repos (id, working_path, upstream_url) VALUES (?, ?, ?)')
      for (const [id, wp] of rows) ins.run(id, wp, 'https://example/repo')
    }
    db.close()
    return p
  }

  it('returns the repoId → working_path map from a seeded state.sqlite', () => {
    const p = seed([
      ['f9184ba0b6db', '/Users/x/Desktop/Mesh'],
      ['018d9e76994c', '/Users/x/Documents/moves']
    ])
    const map = readRepoWorkingPaths(p)
    expect(map.get('f9184ba0b6db')).toBe('/Users/x/Desktop/Mesh')
    expect(map.get('018d9e76994c')).toBe('/Users/x/Documents/moves')
    expect(map.size).toBe(2)
  })

  it('returns an empty map when the file is absent (never throws)', () => {
    expect(readRepoWorkingPaths(join(tmpRoot, 'nope.sqlite')).size).toBe(0)
  })

  it('returns an empty map when the schema has no repos table', () => {
    const p = seed([], 'CREATE TABLE something_else (a TEXT)')
    expect(readRepoWorkingPaths(p).size).toBe(0)
  })

  it('returns an empty map when the file is not a database', () => {
    const p = join(tmpRoot, 'garbage.sqlite')
    rmSync(p, { force: true })
    writeFileSync(p, 'not a sqlite file at all', 'utf-8')
    expect(readRepoWorkingPaths(p).size).toBe(0)
  })

  it('skips rows with a null / empty working_path rather than mapping them', () => {
    const p = join(tmpRoot, 'state.sqlite')
    const db = new Database(p)
    db.exec('CREATE TABLE repos (id TEXT PRIMARY KEY, working_path TEXT)')
    db.prepare('INSERT INTO repos (id, working_path) VALUES (?, ?)').run('a', '')
    db.prepare('INSERT INTO repos (id, working_path) VALUES (?, ?)').run('b', '/real/path')
    db.close()
    const map = readRepoWorkingPaths(p)
    expect(map.has('a')).toBe(false)
    expect(map.get('b')).toBe('/real/path')
  })
})

describe('readRunEnrichment', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'mesh-runs-'))
  })
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  const RUNS_SCHEMA =
    'CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT, pr_url TEXT, pr_state TEXT, branch TEXT, intent TEXT)'

  function seedRuns(
    rows: Array<[string, string | null, string | null, string | null, string | null, string | null]>
  ): string {
    const p = join(tmpRoot, 'state.sqlite')
    const db = new Database(p)
    db.exec(RUNS_SCHEMA)
    const ins = db.prepare(
      'INSERT INTO runs (id, status, pr_url, pr_state, branch, intent) VALUES (?, ?, ?, ?, ?, ?)'
    )
    for (const r of rows) ins.run(...r)
    db.close()
    return p
  }

  it('returns the runId → enrichment map from a seeded runs table', () => {
    const p = seedRuns([
      [
        '01M320PARHRXZETXMJX80Z382A',
        'completed',
        'https://github.com/x/moves/pull/58',
        'merged',
        '16-event-detail-sheet',
        'Build the consumer event detail sheet'
      ],
      ['01M32QJKD6G47N5SPQVCB8RJ7A', 'failed', null, 'none', '17-get-directions', 'Build directions']
    ])
    const map = readRunEnrichment(p)
    expect(map.get('01M320PARHRXZETXMJX80Z382A')).toEqual({
      status: 'completed',
      prUrl: 'https://github.com/x/moves/pull/58',
      prState: 'merged',
      branch: '16-event-detail-sheet',
      intent: 'Build the consumer event detail sheet'
    })
    expect(map.get('01M32QJKD6G47N5SPQVCB8RJ7A')).toEqual({
      status: 'failed',
      prUrl: null,
      prState: 'none',
      branch: '17-get-directions',
      intent: 'Build directions'
    })
  })

  it('normalizes an unrecognized status to null (only completed/failed carry a glyph)', () => {
    const p = seedRuns([['r1', 'running', null, null, 'wip', 'in progress']])
    expect(readRunEnrichment(p).get('r1')?.status).toBeNull()
  })

  it('maps empty text columns to null rather than empty strings', () => {
    const p = seedRuns([['r1', 'completed', '', '', '', '']])
    expect(readRunEnrichment(p).get('r1')).toEqual({
      status: 'completed',
      prUrl: null,
      prState: null,
      branch: null,
      intent: null
    })
  })

  it('returns an empty map when the file is absent (never throws)', () => {
    expect(readRunEnrichment(join(tmpRoot, 'nope.sqlite')).size).toBe(0)
  })

  it('returns an empty map when the schema has no runs table', () => {
    const p = join(tmpRoot, 'state.sqlite')
    const db = new Database(p)
    db.exec('CREATE TABLE repos (id TEXT PRIMARY KEY, working_path TEXT)')
    db.close()
    expect(readRunEnrichment(p).size).toBe(0)
  })

  it('returns an empty map when the file is not a database', () => {
    const p = join(tmpRoot, 'garbage.sqlite')
    writeFileSync(p, 'not a sqlite file at all', 'utf-8')
    expect(readRunEnrichment(p).size).toBe(0)
  })
})

describe('NoMistakesStateReader (cache)', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'mesh-state-'))
  })
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function seed(id: string, workingPath: string): string {
    const p = join(tmpRoot, 'state.sqlite')
    rmSync(p, { force: true })
    const db = new Database(p)
    db.exec('CREATE TABLE repos (id TEXT PRIMARY KEY, working_path TEXT NOT NULL)')
    db.prepare('INSERT INTO repos (id, working_path) VALUES (?, ?)').run(id, workingPath)
    db.close()
    return p
  }

  it('serves a cached map within the TTL and re-reads after it', () => {
    const dbPath = join(tmpRoot, 'state.sqlite')
    seed('a', '/one')
    let now = 1_000
    const reader = new NoMistakesStateReader({ dbPath, now: () => now, ttlMs: 5_000 })

    expect(reader.readRepoWorkingPaths().get('a')).toBe('/one')

    // Change the store underneath the cache; within the TTL the old map stands.
    seed('a', '/two')
    now = 4_000
    expect(reader.readRepoWorkingPaths().get('a')).toBe('/one')

    // Past the TTL it re-opens and sees the new value.
    now = 7_000
    expect(reader.readRepoWorkingPaths().get('a')).toBe('/two')
  })

  it('reads repos and runs from one shared cache window', () => {
    const dbPath = join(tmpRoot, 'state.sqlite')
    const db = new Database(dbPath)
    db.exec('CREATE TABLE repos (id TEXT PRIMARY KEY, working_path TEXT NOT NULL)')
    db.exec('CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT, pr_url TEXT, pr_state TEXT, branch TEXT, intent TEXT)')
    db.prepare('INSERT INTO repos (id, working_path) VALUES (?, ?)').run('repo1', '/one')
    db.prepare('INSERT INTO runs (id, status) VALUES (?, ?)').run('run1', 'completed')
    db.close()

    let now = 1_000
    const reader = new NoMistakesStateReader({ dbPath, now: () => now, ttlMs: 5_000 })
    expect(reader.readRepoWorkingPaths().get('repo1')).toBe('/one')
    expect(reader.readRunEnrichment().get('run1')?.status).toBe('completed')

    // Both reads are served from the same window — deleting the file mid-TTL
    // doesn't disturb either cached map.
    rmSync(dbPath, { force: true })
    now = 3_000
    expect(reader.readRepoWorkingPaths().get('repo1')).toBe('/one')
    expect(reader.readRunEnrichment().get('run1')?.status).toBe('completed')
  })
})
