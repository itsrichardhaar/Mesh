import { act, fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import type { Project } from '@shared/types'
import { syntheticParentId } from '@shared/types'
import { ProjectSidebar } from '@renderer/components/ProjectSidebar'
import type { ProjectListState } from '@renderer/hooks/useProjectList'

/**
 * Slice B (v11 / ADR-0014): Worktree Runs nest under their Parent Project in a
 * per-subtype disclosure, collapsed by default, expandable on click; search on
 * a child reveals it; unresolved parents collapse under a synthetic node.
 */

function project(overrides: Partial<Project> = {}): Project {
  return {
    encodedPath: '-Users-x-Documents-moves',
    sourcePath: '/Users/x/Documents/moves',
    name: 'moves',
    autoSubtitle: null,
    activity: '2026-09-21T12:00:00.000Z',
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

function gateRun(name: string, parent: string, overrides: Partial<Project> = {}): Project {
  return project({
    encodedPath: `-run-${name}`,
    sourcePath: `/Users/x/.no-mistakes/worktrees/018d9e76994c/${name}`,
    name,
    sourceMissing: true,
    kind: 'worktreeRun',
    subtype: 'gate',
    parentEncodedPath: parent,
    ...overrides
  })
}

async function renderSidebar(projects: Project[]): Promise<void> {
  const state: ProjectListState = { status: 'ok', projects }
  render(
    <ProjectSidebar
      state={state}
      refresh={vi.fn()}
      selectedEncodedPath={null}
      onSelect={vi.fn()}
      onOpen={vi.fn()}
    />
  )
  await act(async () => {})
}

describe('ProjectSidebar — Worktree Run nesting (Slice B)', () => {
  it('nests a gate run under its Parent, collapsed by default', async () => {
    await renderSidebar([project(), gateRun('01M320PAR', '-Users-x-Documents-moves')])
    // Parent is visible; the run is hidden behind a collapsed disclosure.
    expect(screen.getByText('moves')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Gate runs \(1\)/ })).toBeInTheDocument()
    expect(screen.queryByText('01M320PAR')).not.toBeInTheDocument()
  })

  it('reveals runs when the disclosure is expanded', async () => {
    await renderSidebar([project(), gateRun('01M320PAR', '-Users-x-Documents-moves')])
    const toggle = screen.getByRole('button', { name: /Gate runs \(1\)/ })
    await act(async () => {
      fireEvent.click(toggle)
    })
    expect(screen.getByText('01M320PAR')).toBeInTheDocument()
  })

  it('labels a plain worktree group "Worktree runs"', async () => {
    await renderSidebar([
      project({ encodedPath: '-main', sourcePath: '/repo', name: 'repo' }),
      gateRun('feature', '-main', { subtype: 'plain', gate: null })
    ])
    expect(screen.getByRole('button', { name: /Worktree runs \(1\)/ })).toBeInTheDocument()
  })

  it('groups runs with no discovered Parent under a synthetic node, never at top level', async () => {
    await renderSidebar([gateRun('01M320PAR', syntheticParentId('moves'))])
    // The synthetic label stands in for the repo; the run is still nested.
    expect(screen.getByText('moves')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Gate runs \(1\)/ })).toBeInTheDocument()
    expect(screen.queryByText('01M320PAR')).not.toBeInTheDocument()
  })

  it('search matching a child reveals its Parent and the child', async () => {
    await renderSidebar([
      project(),
      project({ encodedPath: '-other', sourcePath: '/o', name: 'other' }),
      gateRun('01M320PAR', '-Users-x-Documents-moves')
    ])
    const search = screen.getByLabelText('Search projects')
    await act(async () => {
      fireEvent.change(search, { target: { value: '01M320' } })
    })
    // The matching run is revealed; the unrelated Project drops out.
    expect(screen.getByText('01M320PAR')).toBeInTheDocument()
    expect(screen.queryByText('other')).not.toBeInTheDocument()
  })
})
