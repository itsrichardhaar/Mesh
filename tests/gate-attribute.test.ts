import { describe, it, expect } from 'vitest'
import { syntheticParentId } from '@shared/types'
import { attributeWorktreeRuns, type AttributionDeps } from '@main/gate/attribute'
import type { DiscoveredProject } from '@main/projects/enumerator'

/**
 * Attribution of Worktree Runs to their Parent Project (ADR-0014, Slice B).
 * Pure over injected seams — no DB, no git subprocess.
 */

function proj(overrides: Partial<DiscoveredProject> = {}): DiscoveredProject {
  return {
    encodedPath: '-Users-x-Documents-moves',
    sourcePath: '/Users/x/Documents/moves',
    name: 'moves',
    activity: '2026-09-21T12:00:00.000Z',
    sourceMissing: false,
    kind: 'project',
    subtype: null,
    gate: null,
    ...overrides
  }
}

function gateRun(repoId: string, overrides: Partial<DiscoveredProject> = {}): DiscoveredProject {
  return proj({
    encodedPath: `-run-${repoId}`,
    sourcePath: `/Users/x/.no-mistakes/worktrees/${repoId}/01M320PARHRXZETXMJX80Z382A`,
    name: '01M320PARHRXZETXMJX80Z382A',
    sourceMissing: true,
    kind: 'worktreeRun',
    subtype: 'gate',
    gate: {
      repoId,
      runId: '01M320PARHRXZETXMJX80Z382A',
      status: null,
      prUrl: null,
      prState: null,
      branch: null,
      intent: null
    },
    ...overrides
  })
}

const noWorktrees: AttributionDeps['resolveMainWorktree'] = async () => null
const identity: AttributionDeps['canonicalize'] = (p) => p

function deps(over: Partial<AttributionDeps> = {}): AttributionDeps {
  return {
    gateRepos: new Map(),
    resolveMainWorktree: noWorktrees,
    canonicalize: identity,
    ...over
  }
}

describe('attributeWorktreeRuns', () => {
  it('attributes a Gate Run to the discovered Project sharing its working_path', async () => {
    const parent = proj()
    const run = gateRun('018d9e76994c')
    const out = await attributeWorktreeRuns(
      [parent, run],
      deps({ gateRepos: new Map([['018d9e76994c', '/Users/x/Documents/moves']]) })
    )
    expect(out.find((p) => p.encodedPath === '-run-018d9e76994c')?.parentEncodedPath).toBe(
      parent.encodedPath
    )
    // The ordinary Project keeps a null parent.
    expect(out.find((p) => p.encodedPath === parent.encodedPath)?.parentEncodedPath).toBeNull()
  })

  it('canonicalizes both sides so a symlinked working_path still matches', async () => {
    const parent = proj({ sourcePath: '/private/var/moves', encodedPath: '-p' })
    const run = gateRun('r1')
    const out = await attributeWorktreeRuns(
      [parent, run],
      deps({
        gateRepos: new Map([['r1', '/var/moves']]), // /var → /private/var
        canonicalize: (p) => p.replace(/^\/var\//, '/private/var/')
      })
    )
    expect(out.find((p) => p.kind === 'worktreeRun')?.parentEncodedPath).toBe('-p')
  })

  it('falls back to a synthetic node (repo name) when working_path is undiscovered', async () => {
    const run = gateRun('018d9e76994c')
    const out = await attributeWorktreeRuns(
      [run],
      deps({ gateRepos: new Map([['018d9e76994c', '/Users/x/Documents/moves']]) })
    )
    expect(out[0]?.parentEncodedPath).toBe(syntheticParentId('moves'))
  })

  it('falls back to a synthetic node (repoId) when the state read is empty', async () => {
    const run = gateRun('018d9e76994c')
    const out = await attributeWorktreeRuns([run], deps({ gateRepos: new Map() }))
    expect(out[0]?.parentEncodedPath).toBe(syntheticParentId('018d9e76994c'))
  })

  it('upgrades a live git worktree to a plain Worktree Run and attributes it', async () => {
    const parent = proj({ encodedPath: '-main', sourcePath: '/repo' })
    const wt = proj({
      encodedPath: '-wt',
      sourcePath: '/repo/.worktrees/feature',
      name: 'feature'
    })
    const out = await attributeWorktreeRuns(
      [parent, wt],
      deps({
        resolveMainWorktree: async (dir) => (dir === '/repo/.worktrees/feature' ? '/repo' : null)
      })
    )
    const upgraded = out.find((p) => p.encodedPath === '-wt')
    expect(upgraded?.kind).toBe('worktreeRun')
    expect(upgraded?.subtype).toBe('plain')
    expect(upgraded?.parentEncodedPath).toBe('-main')
  })

  it('leaves an ordinary Project untouched when git reports no worktree', async () => {
    const out = await attributeWorktreeRuns([proj()], deps())
    expect(out[0]?.kind).toBe('project')
    expect(out[0]?.parentEncodedPath).toBeNull()
  })

  it('does not probe git for a Source-Missing Project', async () => {
    let probed = false
    await attributeWorktreeRuns(
      [proj({ sourceMissing: true })],
      deps({
        resolveMainWorktree: async () => {
          probed = true
          return null
        }
      })
    )
    expect(probed).toBe(false)
  })
})
