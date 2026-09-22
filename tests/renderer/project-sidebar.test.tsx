import { act, render, screen, within } from '@testing-library/react'
import { vi } from 'vitest'
import type { Project } from '@shared/types'
import { ProjectSidebar } from '@renderer/components/ProjectSidebar'
import type { ProjectListState } from '@renderer/hooks/useProjectList'

/**
 * Slice A (v11 / ADR-0014): a recognized Worktree Run wears a calm
 * **no-mistakes** / **worktree** tag instead of the Source-Missing alarm.
 * Runs are still flat here; nesting arrives in Slice B.
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

describe('ProjectSidebar — Worktree Run tag (Slice A)', () => {
  it('tags a gate run "no-mistakes" and never shows the Source-Missing alarm', async () => {
    await renderSidebar([project(), gateRun()])
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
    expect(screen.getByText('worktree')).toBeInTheDocument()
  })

  it('marks the run row as a run (not the missing-alarm styling)', async () => {
    await renderSidebar([gateRun()])
    const runButton = screen.getByRole('button', { name: /01M320PARHRXZETXMJX80Z382A/ })
    expect(runButton.className).toContain('project-row-run')
    expect(runButton.className).not.toContain('project-row-missing')
    // The tag lives inside the run row.
    expect(within(runButton).getByText('no-mistakes')).toBeInTheDocument()
  })
})
