import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@main/db/migrations'
import { insertUsageEvents } from '@main/usage/repository'
import {
  distinctUsageEncodedPaths,
  sumTokensByProjectGroup,
  projectMeta
} from '@main/usage/repository'
import { recognizeGateRunEncodedPath } from '@main/gate/recognize'
import { resolveGateParentEncodedPath } from '@main/gate/attribute'
import { buildRunAttribution, type AttributionEntry } from '@main/gate/rollup'
import { buildProjectRows } from '@main/usage/dashboard'
import type { UsageEvent } from '@shared/types'

/**
 * End-to-end reproduction of the bug fixed in b05be97: a Gate Run whose worktree
 * merged and whose `~/.claude/projects/<encoded>/` session dir was later removed
 * is NO LONGER discovered on disk, yet its `usage_events` rows remain. Before the
 * fix its tokens leaked as a standalone ULID row and undercounted the Parent.
 *
 * This exercises the exact `currentRunAttribution` undiscovered-run branch
 * against a real SQLite database (not the isolated pure functions): real
 * migrations + real `usage_events` → `distinctUsageEncodedPaths` →
 * `recognizeGateRunEncodedPath` → `resolveGateParentEncodedPath` →
 * `buildRunAttribution` → `buildProjectRows`.
 */

const PARENT_ENCODED = '-Users-richardhaar-Desktop-Mesh'
const PARENT_SOURCE = '/Users/richardhaar/Desktop/Mesh'
const REPO_ID = 'f9184ba0b6db'
// A real Claude Code Encoded Path for a merged/undiscovered gate run worktree.
const UNDISCOVERED_RUN_ENCODED =
  '-Users-richardhaar--no-mistakes-worktrees-f9184ba0b6db-01M089YQEMNS34T9ZAZBZWB6S8'

function ev(encodedPath: string, sessionId: string, eventId: string, output: number): UsageEvent {
  return {
    eventId,
    encodedPath,
    sessionId,
    timestamp: '2026-09-22T12:00:00Z',
    model: 'claude-opus-4-8',
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: output,
    serviceTier: 'standard',
    gitBranch: 'main',
    cwd: '/x',
    sourceFile: '/x/s.jsonl',
    sourceLine: 1
  }
}

/**
 * Faithful copy of `currentRunAttribution`'s attribution assembly, minus its
 * Electron-only discovery (`listProjects`, `getDatabase`). We inject the
 * discovered Projects and the `repoId → working_path` map directly, so the
 * DB-backed undiscovered-run fold is what's under test.
 */
function attributionFromDb(
  db: Database.Database,
  discoveredProjects: Array<{ encodedPath: string; sourcePath: string }>,
  gateRepos: Map<string, string>
) {
  const canonicalize = (p: string): string => p
  const entries: AttributionEntry[] = discoveredProjects.map((p) => ({
    encodedPath: p.encodedPath,
    parentEncodedPath: null // real Projects have no Parent
  }))
  const known = new Set(entries.map((e) => e.encodedPath))
  const parentEncodedByPath = new Map<string, string>()
  for (const p of discoveredProjects) parentEncodedByPath.set(canonicalize(p.sourcePath), p.encodedPath)

  for (const encodedPath of distinctUsageEncodedPaths(db)) {
    if (known.has(encodedPath)) continue
    const rec = recognizeGateRunEncodedPath(encodedPath)
    if (!rec) continue
    entries.push({
      encodedPath,
      parentEncodedPath: resolveGateParentEncodedPath(
        gateRepos.get(rec.repoId),
        rec.repoId,
        parentEncodedByPath,
        canonicalize
      )
    })
  }
  return buildRunAttribution(entries)
}

describe('Usage rollup folds an undiscovered Gate Run into its Parent (e2e vs real DB)', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    // Parent Project has 100 output tokens; the undiscovered gate run has 40.
    insertUsageEvents(db, [
      ev(PARENT_ENCODED, 'parent-s1', 'p1', 100),
      ev(UNDISCOVERED_RUN_ENCODED, 'run-s1', 'r1', 40)
    ])
  })
  afterEach(() => db.close())

  it('recognizes the run from its Encoded Path and points it at the Parent', () => {
    const attribution = attributionFromDb(
      db,
      [{ encodedPath: PARENT_ENCODED, sourcePath: PARENT_SOURCE }],
      new Map([[REPO_ID, PARENT_SOURCE]])
    )
    // The run's Usage now displays under the Parent, not as a ULID row.
    expect(attribution.displayEncodedPath(UNDISCOVERED_RUN_ENCODED)).toBe(PARENT_ENCODED)
    expect(attribution.membersOf(PARENT_ENCODED)).toEqual(
      expect.arrayContaining([PARENT_ENCODED, UNDISCOVERED_RUN_ENCODED])
    )
  })

  it('by-project breakdown shows ONE Parent row with the run folded in (no ULID leak)', () => {
    const attribution = attributionFromDb(
      db,
      [{ encodedPath: PARENT_ENCODED, sourcePath: PARENT_SOURCE }],
      new Map([[REPO_ID, PARENT_SOURCE]])
    )
    const rows = buildProjectRows(
      sumTokensByProjectGroup(db),
      projectMeta(db),
      attribution.displayEncodedPath
    )
    // Exactly one row: the Parent, holding parent + run tokens (100 + 40).
    expect(rows).toHaveLength(1)
    expect(rows[0].encodedPath).toBe(PARENT_ENCODED)
    expect(rows[0].tokens).toBe(140)
    expect(rows[0].sessionCount).toBe(2)
    // The bug would have surfaced a second, ULID-keyed row.
    expect(rows.some((r) => r.encodedPath === UNDISCOVERED_RUN_ENCODED)).toBe(false)
  })

  it('regression: without the fix the run would leak as its own row', () => {
    // Identity resolve == pre-fix behavior (no rollup): two rows, undercounted Parent.
    const rows = buildProjectRows(sumTokensByProjectGroup(db), projectMeta(db))
    expect(rows).toHaveLength(2)
    const parent = rows.find((r) => r.encodedPath === PARENT_ENCODED)
    const leaked = rows.find((r) => r.encodedPath === UNDISCOVERED_RUN_ENCODED)
    expect(parent?.tokens).toBe(100) // undercounted
    expect(leaked?.tokens).toBe(40) // leaked ULID row
  })
})
