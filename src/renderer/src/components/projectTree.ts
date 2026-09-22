import type { Project } from '@shared/types'
import { syntheticParentLabel } from '@shared/types'

/**
 * Builds the sidebar's two-level tree from the flat Project list (ADR-0014,
 * Slice B). Top-level rows are real Projects and synthetic grouping nodes;
 * each Worktree Run nests under its Parent inside a per-subtype disclosure
 * (`Gate runs (N)` / `Worktree runs (N)`). Pure and side-effect-free so it
 * unit-tests against plain data.
 */

/** A per-subtype disclosure of a Parent's Worktree Runs. */
export interface RunGroup {
  /** Stable collapse key, `${parentId}:${subtype}`. */
  key: string
  subtype: 'gate' | 'plain'
  /** `Gate runs (N)` / `Worktree runs (N)`. */
  label: string
  runs: Project[]
}

/** A top-level sidebar row plus the run groups nested under it. */
export type SidebarNode =
  | { type: 'project'; id: string; project: Project; groups: RunGroup[] }
  | { type: 'synthetic'; id: string; label: string; groups: RunGroup[] }

const SUBTYPE_ORDER: ReadonlyArray<'gate' | 'plain'> = ['gate', 'plain']

function groupLabel(subtype: 'gate' | 'plain', n: number): string {
  return subtype === 'gate' ? `Gate runs (${n})` : `Worktree runs (${n})`
}

function makeGroups(parentId: string, runs: Project[]): RunGroup[] {
  const groups: RunGroup[] = []
  for (const subtype of SUBTYPE_ORDER) {
    const subset = runs.filter((r) => r.subtype === subtype)
    if (subset.length === 0) continue
    groups.push({
      key: `${parentId}:${subtype}`,
      subtype,
      label: groupLabel(subtype, subset.length),
      runs: subset
    })
  }
  return groups
}

/** The activity a node sorts by — its own, or its newest run when later. */
function nodeActivity(ownActivity: string | null, runs: Project[]): string {
  return runs.reduce(
    (max, r) => (r.activity > max ? r.activity : max),
    ownActivity ?? ''
  )
}

export function buildProjectTree(projects: Project[]): SidebarNode[] {
  const realParents = new Map<string, Project>()
  const runs: Project[] = []
  for (const p of projects) {
    if (p.kind === 'worktreeRun') runs.push(p)
    else realParents.set(p.encodedPath, p)
  }

  // Bucket runs by the Parent id they point at (real Encoded Path or synthetic).
  const runsByParent = new Map<string, Project[]>()
  for (const run of runs) {
    const parentId = run.parentEncodedPath
    if (!parentId) continue // a run we couldn't place; drop rather than orphan at top level
    const bucket = runsByParent.get(parentId)
    if (bucket) bucket.push(run)
    else runsByParent.set(parentId, [run])
  }

  const nodes: Array<{ node: SidebarNode; sortActivity: string }> = []

  // Real Projects (each may or may not parent runs).
  for (const project of realParents.values()) {
    const childRuns = runsByParent.get(project.encodedPath) ?? []
    nodes.push({
      node: { type: 'project', id: project.encodedPath, project, groups: makeGroups(project.encodedPath, childRuns) },
      sortActivity: nodeActivity(project.activity, childRuns)
    })
  }

  // Synthetic grouping nodes — buckets whose Parent isn't a discovered Project.
  for (const [parentId, childRuns] of runsByParent) {
    if (realParents.has(parentId)) continue
    nodes.push({
      node: {
        type: 'synthetic',
        id: parentId,
        label: syntheticParentLabel(parentId) ?? parentId,
        groups: makeGroups(parentId, childRuns)
      },
      sortActivity: nodeActivity(null, childRuns)
    })
  }

  nodes.sort((a, b) => (a.sortActivity < b.sortActivity ? 1 : a.sortActivity > b.sortActivity ? -1 : 0))
  return nodes.map((n) => n.node)
}
