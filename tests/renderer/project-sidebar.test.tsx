import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { vi } from 'vitest'
import type { Project } from '@shared/types'
import { syntheticParentId } from '@shared/types'
import { ProjectSidebar } from '@renderer/components/ProjectSidebar'
import type { ProjectListState } from '@renderer/hooks/useProjectList'

/**
 * Slice A (v11 / ADR-0014): a recognized Worktree Run wears a calm
 * **no-mistakes** / **worktree** tag instead of the Source-Missing alarm.
 * Slice B nests runs under a Parent, so these tests expand the disclosure
 * before asserting on the (now nested) run row.
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

function gateRun(overrides: Partial<Project> = {}): Project {
  return project({
    encodedPath: '-Users-x--no-mistakes-worktrees-018d9e76994c-01M320PARHRXZETXMJX80Z382A',
    sourcePath: '/Users/x/.no-mistakes/worktrees/018d9e76994c/01M320PARHRXZETXMJX80Z382A',
    name: '01M320PARHRXZETXMJX80Z382A',
    sourceMissing: true,
    kind: 'worktreeRun',
    subtype: 'gate',
    // Slice B: a run always nests under a Parent; a synthetic node stands in
    // when (as here) no real Parent Project is in the list.
    parentEncodedPath: syntheticParentId('moves'),
    gate: {
      repoId: '018d9e76994c',
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
  // Settle mount effects (sidebar width measure, live-session subscribe).
  await act(async () => {})
}

/** Expand every collapsed run-group disclosure so nested run rows render. */
async function expandAllGroups(): Promise<void> {
  const toggles = screen.queryAllByRole('button', { name: /runs \(\d+\)/ })
  for (const toggle of toggles) {
    await act(async () => {
      fireEvent.click(toggle)
    })
  }
}

describe('ProjectSidebar — Worktree Run tag (Slice A)', () => {
  it('tags a gate run "no-mistakes" and never shows the Source-Missing alarm', async () => {
    await renderSidebar([project(), gateRun()])
    await expandAllGroups()
    expect(screen.getByText('no-mistakes')).toBeInTheDocument()
    // Even though the run's worktree is deleted (sourceMissing), the alarm is suppressed.
    expect(screen.queryByText('Source missing')).not.toBeInTheDocument()
  })

  it('still shows the Source-Missing alarm for a genuinely lost ordinary Project', async () => {
    await renderSidebar([project({ sourceMissing: true })])
    expect(screen.getByText('Source missing')).toBeInTheDocument()
    expect(screen.queryByText('no-mistakes')).not.toBeInTheDocument()
  })

  it('labels a plain (non-gate) worktree run "worktree"', async () => {
    await renderSidebar([gateRun({ subtype: 'plain', gate: null })])
    await expandAllGroups()
    expect(screen.getByText('worktree')).toBeInTheDocument()
  })

  it('marks the run row as a run (not the missing-alarm styling)', async () => {
    await renderSidebar([gateRun()])
    await expandAllGroups()
    const runButton = screen.getByRole('button', { name: /01M320PARHRXZETXMJX80Z382A/ })
    expect(runButton.className).toContain('project-row-run')
    expect(runButton.className).not.toContain('project-row-missing')
    // The tag lives inside the run row.
    expect(within(runButton).getByText('no-mistakes')).toBeInTheDocument()
  })
})

describe('ProjectSidebar — hiding a Parent takes its runs (Slice B)', () => {
  it('hides a Parent and its runs together, never leaking a raw Encoded Path header', async () => {
    const parent = project()
    const run = gateRun({ parentEncodedPath: parent.encodedPath })
    await renderSidebar([project({ hidden: true }), run])

    // The Parent is hidden, so its run must vanish with it — no run group and no
    // raw-Encoded-Path synthetic header standing in for the hidden Parent.
    expect(screen.queryByText('moves')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /runs \(\d+\)/ })).not.toBeInTheDocument()
    expect(screen.queryByText(parent.encodedPath)).not.toBeInTheDocument()

    // Toggling "Show Hidden" brings the Parent and its run back together.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Show Hidden/ }))
    })
    expect(screen.getByText('moves')).toBeInTheDocument()
    await expandAllGroups()
    expect(
      screen.getByRole('button', { name: /01M320PARHRXZETXMJX80Z382A/ })
    ).toBeInTheDocument()
  })

  it('keeps runs of a non-hidden Parent visible', async () => {
    const parent = project()
    const run = gateRun({ parentEncodedPath: parent.encodedPath })
    await renderSidebar([parent, run])
    expect(screen.getByText('moves')).toBeInTheDocument()
    await expandAllGroups()
    expect(
      screen.getByRole('button', { name: /01M320PARHRXZETXMJX80Z382A/ })
    ).toBeInTheDocument()
  })
})
