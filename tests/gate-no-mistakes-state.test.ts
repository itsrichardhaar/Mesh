import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { NoMistakesStateReader, readRepoWorkingPaths } from '@main/gate/no-mistakes-state'

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
})
