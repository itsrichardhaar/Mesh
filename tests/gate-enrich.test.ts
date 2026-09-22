import { describe, it, expect } from 'vitest'
import { enrichGateRuns } from '@main/gate/enrich'
import type { AttributedProject } from '@main/gate/attribute'
import type { GateRunEnrichment } from '@main/gate/no-mistakes-state'

/**
 * Gate Run enrichment (ADR-0014, Slice C). Pure fold of the `runId → metadata`
 * map into each Gate Run's `gate` field; best-effort, so a missing entry (or an
 * empty map from a failed ring-fenced read) leaves the run's recognized ids
 * untouched.
 */

function attributed(overrides: Partial<AttributedProject> = {}): AttributedProject {
  return {
    encodedPath: '-Users-x-Documents-moves',
    sourcePath: '/Users/x/Documents/moves',
    name: 'moves',
    activity: '2026-09-21T12:00:00.000Z',
    sourceMissing: false,
    kind: 'project',
    subtype: null,
    gate: null,
    parentEncodedPath: null,
    ...overrides
  }
}

function gateRun(runId: string, overrides: Partial<AttributedProject> = {}): AttributedProject {
  return attributed({
    encodedPath: `-run-${runId}`,
    sourcePath: `/Users/x/.no-mistakes/worktrees/abc123/${runId}`,
    name: runId,
    sourceMissing: true,
    kind: 'worktreeRun',
    subtype: 'gate',
    parentEncodedPath: '-Users-x-Documents-moves',
    gate: {
      repoId: 'abc123',
      runId,
      status: null,
      prUrl: null,
      prState: null,
      branch: null,
      intent: null
    },
    ...overrides
  })
}

const meta = (over: Partial<GateRunEnrichment> = {}): GateRunEnrichment => ({
  status: 'completed',
  prUrl: 'https://github.com/x/moves/pull/58',
  prState: 'merged',
  branch: '16-event-detail-sheet',
  intent: 'Build the consumer event detail sheet',
  ...over
})

describe('enrichGateRuns', () => {
  it('folds run metadata into a matching Gate Run, preserving its ids', () => {
    const run = gateRun('01M320PARHRXZETXMJX80Z382A')
    const [out] = enrichGateRuns([run], new Map([['01M320PARHRXZETXMJX80Z382A', meta()]]))
    expect(out.gate).toEqual({
      repoId: 'abc123',
      runId: '01M320PARHRXZETXMJX80Z382A',
      status: 'completed',
      prUrl: 'https://github.com/x/moves/pull/58',
      prState: 'merged',
      branch: '16-event-detail-sheet',
      intent: 'Build the consumer event detail sheet'
    })
  })

  it('leaves a Gate Run untouched when the map has no entry for it', () => {
    const run = gateRun('01M320PARHRXZETXMJX80Z382A')
    const [out] = enrichGateRuns([run], new Map())
    expect(out.gate).toEqual(run.gate)
  })

  it('never touches ordinary Projects or the gate-less plain worktree subtype', () => {
    const project = attributed()
    const plain = gateRun('01PLAIN', { subtype: 'plain', gate: null })
    const [p, pl] = enrichGateRuns(
      [project, plain],
      new Map([['01PLAIN', meta()]]) // even a same-id entry must not apply
    )
    expect(p.gate).toBeNull()
    expect(pl.gate).toBeNull()
  })

  it('enriches each run from its own entry across a mixed list', () => {
    const a = gateRun('01A')
    const b = gateRun('01B')
    const out = enrichGateRuns(
      [a, b],
      new Map([
        ['01A', meta({ status: 'completed', intent: 'A' })],
        ['01B', meta({ status: 'failed', prUrl: null, prState: 'none', intent: 'B' })]
      ])
    )
    expect(out[0].gate?.intent).toBe('A')
    expect(out[0].gate?.status).toBe('completed')
    expect(out[1].gate?.intent).toBe('B')
    expect(out[1].gate?.status).toBe('failed')
    expect(out[1].gate?.prUrl).toBeNull()
  })
})
