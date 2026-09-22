import { describe, it, expect } from 'vitest'
import type { Project } from '@shared/types'
import { syntheticParentId } from '@shared/types'
import { buildProjectTree } from '@renderer/components/projectTree'

/** buildProjectTree — the pure grouping behind the sidebar tree (ADR-0014). */

function project(overrides: Partial<Project> = {}): Project {
  return {
    encodedPath: '-main',
    sourcePath: '/repo',
    name: 'repo',
    autoSubtitle: null,
    activity: '2026-09-20T00:00:00.000Z',
    sourceMissing: false,
    hidden: false,
    muteNotifications: false,
    kind: 'project',
    subtype: null,
    parentEncodedPath: null,
    gate: null,
    ...overrides
  }
}

function run(id: string, parent: string | null, overrides: Partial<Project> = {}): Project {
  return project({
    encodedPath: `-run-${id}`,
    name: id,
    sourceMissing: true,
    kind: 'worktreeRun',
    subtype: 'gate',
    parentEncodedPath: parent,
    ...overrides
  })
}

describe('buildProjectTree', () => {
  it('nests runs under their real Parent in a per-subtype group', () => {
    const tree = buildProjectTree([
      project(),
      run('A', '-main'),
      run('B', '-main', { subtype: 'plain' })
    ])
    expect(tree).toHaveLength(1)
    const node = tree[0]
    expect(node.type).toBe('project')
    expect(node.groups.map((g) => g.label)).toEqual(['Gate runs (1)', 'Worktree runs (1)'])
    expect(node.groups[0].runs.map((r) => r.name)).toEqual(['A'])
    expect(node.groups[1].runs.map((r) => r.name)).toEqual(['B'])
  })

  it('groups runs with no discovered Parent under a synthetic node', () => {
    const tree = buildProjectTree([run('A', syntheticParentId('moves'))])
    expect(tree).toHaveLength(1)
    expect(tree[0].type).toBe('synthetic')
    expect(tree[0]).toMatchObject({ label: 'moves' })
    expect(tree[0].groups[0].label).toBe('Gate runs (1)')
  })

  it('never renders a run at the top level', () => {
    const tree = buildProjectTree([project(), run('A', '-main')])
    const topLevelIds = tree.map((n) => n.id)
    expect(topLevelIds).not.toContain('-run-A')
  })

  it('drops a run whose parentEncodedPath is null rather than orphaning it', () => {
    const tree = buildProjectTree([run('A', null)])
    expect(tree).toHaveLength(0)
  })

  it('gives each group a stable per-subtype collapse key', () => {
    const tree = buildProjectTree([project(), run('A', '-main')])
    expect(tree[0].groups[0].key).toBe('-main:gate')
  })

  it('sorts a synthetic node by its newest child activity', () => {
    const tree = buildProjectTree([
      project({ encodedPath: '-old', name: 'old', activity: '2026-01-01T00:00:00.000Z' }),
      run('recent', syntheticParentId('fresh'), { activity: '2026-12-01T00:00:00.000Z' })
    ])
    expect(tree.map((n) => (n.type === 'project' ? n.project.name : n.label))).toEqual([
      'fresh',
      'old'
    ])
  })
})
