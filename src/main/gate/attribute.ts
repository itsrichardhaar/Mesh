/**
 * Attributes each Worktree Run to its **Parent Project** and nests it there
 * (ADR-0014). The structural heart of v11: the flat enumerator output goes in,
 * a list with `parentEncodedPath` resolved (and generic worktrees upgraded to
 * the `plain` subtype) comes out.
 *
 * Two attribution paths, mirroring the two recognizers:
 * - **Gate Run** (path-recognized in the enumerator): map `repoId → working_path`
 *   via the ring-fenced state read, then find the discovered Project sharing
 *   that Source Path.
 * - **Plain Worktree Run** (a still-on-disk Project that git reveals to be a
 *   linked worktree): the main worktree is the Parent, resolved in one step.
 *
 * A Parent that can't be resolved to a discovered Project yields a **synthetic
 * grouping-node id** (repo name when known, else `repoId`) — never a fabricated
 * Project (ADR-0002 holds).
 *
 * Pure over its injected seams (`gateRepos`, `resolveMainWorktree`,
 * `canonicalize`) so it tests against in-memory data with no DB or subprocess.
 */
import { basename } from 'node:path'
import { syntheticParentId } from '@shared/types'
import type { DiscoveredProject } from '../projects/enumerator'

export interface AttributionDeps {
  /** `repoId → working_path` from the ring-fenced state read (empty on failure). */
  gateRepos: Map<string, string>
  /** Main-worktree resolver for live generic worktrees (`null` when not one). */
  resolveMainWorktree: (dir: string) => Promise<string | null>
  /** Path canonicalizer for Source Path equality (realpath in production). */
  canonicalize: (p: string) => string
}

/** A discovered Project with its Parent resolved (Slice B). */
export interface AttributedProject extends DiscoveredProject {
  /** Parent's Encoded Path, a synthetic grouping-node id, or `null` (ordinary Project). */
  parentEncodedPath: string | null
}

export async function attributeWorktreeRuns(
  discovered: DiscoveredProject[],
  deps: AttributionDeps
): Promise<AttributedProject[]> {
  // Index real Projects (never runs) by canonical Source Path so a run can find
  // the Parent it shares a working directory with.
  const parentByPath = new Map<string, DiscoveredProject>()
  for (const p of discovered) {
    if (p.kind === 'project') parentByPath.set(deps.canonicalize(p.sourcePath), p)
  }

  return Promise.all(
    discovered.map(async (p): Promise<AttributedProject> => {
      // Gate Run: attribute via the ring-fenced repoId → working_path map.
      if (p.kind === 'worktreeRun' && p.subtype === 'gate') {
        const workingPath = p.gate ? deps.gateRepos.get(p.gate.repoId) : undefined
        return {
          ...p,
          parentEncodedPath: resolveParent(workingPath, p.gate?.repoId, parentByPath, deps)
        }
      }

      // Ordinary on-disk Project: git plumbing may reveal a plain Worktree Run.
      if (p.kind === 'project' && !p.sourceMissing) {
        const mainWorktree = await deps.resolveMainWorktree(p.sourcePath)
        if (mainWorktree) {
          return {
            ...p,
            kind: 'worktreeRun',
            subtype: 'plain',
            parentEncodedPath: resolveParent(mainWorktree, undefined, parentByPath, deps)
          }
        }
      }

      // Ordinary Project, or a run we can't place — no Parent.
      return { ...p, parentEncodedPath: null }
    })
  )
}

/**
 * Resolve a run's Parent to a discovered Project's Encoded Path, or a synthetic
 * grouping-node id when the working path is unknown or undiscovered.
 */
function resolveParent(
  workingPath: string | undefined,
  repoId: string | undefined,
  parentByPath: Map<string, DiscoveredProject>,
  deps: AttributionDeps
): string {
  if (workingPath) {
    const parent = parentByPath.get(deps.canonicalize(workingPath))
    if (parent) return parent.encodedPath
    return syntheticParentId(basename(workingPath) || workingPath)
  }
  return syntheticParentId(repoId ?? 'unknown')
}
