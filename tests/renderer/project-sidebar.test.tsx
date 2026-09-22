import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { vi } from 'vitest'
import type { GateRunMeta, Project } from '@shared/types'
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
    const runButton = screen.getByRole('button', { name: /01M320PA/ })
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
      screen.getByRole('button', { name: /01M320PA/ })
    ).toBeInTheDocument()
  })

  it('keeps runs of a non-hidden Parent visible', async () => {
    const parent = project()
    const run = gateRun({ parentEncodedPath: parent.encodedPath })
    await renderSidebar([parent, run])
    expect(screen.getByText('moves')).toBeInTheDocument()
    await expandAllGroups()
    expect(
      screen.getByRole('button', { name: /01M320PA/ })
    ).toBeInTheDocument()
  })
})

describe('ProjectSidebar — Gate Run enrichment (Slice C)', () => {
  /** A gate run with specific enrichment merged over the all-null defaults. */
  function enriched(gate: Partial<GateRunMeta>): Project {
    return gateRun({
      gate: {
        repoId: '018d9e76994c',
        runId: '01M320PARHRXZETXMJX80Z382A',
        status: null,
        prUrl: null,
        prState: null,
        branch: null,
        intent: null,
        ...gate
      }
    })
  }

  it('shows a ✓ pass glyph, labeled for screen readers, on a completed run', async () => {
    await renderSidebar([enriched({ status: 'completed' })])
    await expandAllGroups()
    expect(screen.getByText('✓')).toHaveAttribute('aria-label', 'passed')
  })

  it('shows a ✗ fail glyph on a failed run', async () => {
    await renderSidebar([enriched({ status: 'failed' })])
    await expandAllGroups()
    expect(screen.getByText('✗')).toHaveAttribute('aria-label', 'failed')
  })

  it('treats a merged PR as a pass even without a completed status', async () => {
    await renderSidebar([enriched({ status: null, prState: 'merged' })])
    await expandAllGroups()
    expect(screen.getByText('✓')).toHaveAttribute('aria-label', 'passed')
  })

  it('labels the row by intent when present', async () => {
    await renderSidebar([enriched({ intent: 'Build the event detail sheet', branch: 'x' })])
    await expandAllGroups()
    expect(screen.getByText('Build the event detail sheet')).toBeInTheDocument()
  })

  it('falls back to the branch when there is no intent', async () => {
    await renderSidebar([enriched({ intent: null, branch: '16-event-detail-sheet' })])
    await expandAllGroups()
    expect(screen.getByText('16-event-detail-sheet')).toBeInTheDocument()
  })

  it('falls back to a short runId when there is neither intent nor branch', async () => {
    await renderSidebar([enriched({ intent: null, branch: null })])
    await expandAllGroups()
    expect(screen.getByText('01M320PA')).toBeInTheDocument()
  })

  it('opens the PR in the default browser from the run row', async () => {
    const url = 'https://github.com/itsrichardhaar/moves/pull/58'
    await renderSidebar([enriched({ prUrl: url })])
    await expandAllGroups()
    const link = screen.getByRole('button', { name: 'Open pull request' })
    await act(async () => {
      fireEvent.click(link)
    })
    expect(window.api.shell.openExternal).toHaveBeenCalledWith(url)
  })

  it('shows no PR affordance when the run has no PR', async () => {
    await renderSidebar([enriched({ prUrl: null })])
    await expandAllGroups()
    expect(screen.queryByRole('button', { name: 'Open pull request' })).not.toBeInTheDocument()
  })

  it('leaves a plain worktree run un-enriched — worktree tag, no glyph, no PR', async () => {
    await renderSidebar([gateRun({ subtype: 'plain', gate: null, name: 'feature-x' })])
    await expandAllGroups()
    expect(screen.getByText('worktree')).toBeInTheDocument()
    expect(screen.queryByText('✓')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open pull request' })).not.toBeInTheDocument()
  })

  it('reveals a run (and its Parent) when search matches the intent', async () => {
    const parent = project()
    const run = gateRun({
      parentEncodedPath: parent.encodedPath,
      gate: enriched({ intent: 'Wire the get-directions route' }).gate
    })
    await renderSidebar([
      parent,
      project({ encodedPath: '-other', sourcePath: '/o', name: 'other' }),
      run
    ])
    const search = screen.getByLabelText('Search projects')
    await act(async () => {
      fireEvent.change(search, { target: { value: 'directions' } })
    })
    expect(screen.getByText('Wire the get-directions route')).toBeInTheDocument()
    expect(screen.queryByText('other')).not.toBeInTheDocument()
  })

  it('reveals a run when search matches the branch', async () => {
    const parent = project()
    const run = gateRun({
      parentEncodedPath: parent.encodedPath,
      gate: enriched({ intent: null, branch: 'fix/map-marker-drift' }).gate
    })
    await renderSidebar([parent, run])
    const search = screen.getByLabelText('Search projects')
    await act(async () => {
      fireEvent.change(search, { target: { value: 'marker-drift' } })
    })
    expect(screen.getByText('fix/map-marker-drift')).toBeInTheDocument()
  })
})
