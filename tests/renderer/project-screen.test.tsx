import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project, StoredAnalysis } from '@shared/types'
import { ProjectScreen } from '@renderer/components/ProjectScreen'
import { meshApi } from './test-utils'

function project(): Project {
  return {
    encodedPath: '-proj-a',
    sourcePath: '/Users/x/proj-a',
    name: 'Alpha',
    autoSubtitle: null,
    activity: '2026-07-13T00:00:00Z',
    sourceMissing: false,
    hidden: false,
    muteNotifications: false,
    kind: 'project',
    subtype: null,
    parentEncodedPath: null,
    gate: null
  }
}

function gateProject(overrides: Partial<Project['gate']> = {}): Project {
  return {
    ...project(),
    encodedPath: '-run-xyz',
    sourcePath: '/Users/x/.no-mistakes/worktrees/f9184b/01M35ATS',
    name: '01M35ATS',
    sourceMissing: true,
    kind: 'worktreeRun',
    subtype: 'gate',
    parentEncodedPath: '-proj-a',
    gate: {
      repoId: 'f9184b',
      runId: '01M35ATS3JQH6KA3G5VF89H2NS',
      status: 'completed',
      prUrl: null,
      prState: null,
      branch: null,
      intent: null,
      ...overrides
    }
  }
}

function okAnalysis(summary: string): StoredAnalysis {
  return {
    encodedPath: '-proj-a',
    generatedAt: '2026-07-13T00:00:00Z',
    status: 'ok',
    errorMessage: null,
    provider: 'claude',
    model: 'claude-opus-4-8',
    sourceSessionCount: 3,
    lastAnalyzedSha: null,
    content: { summaryMarkdown: summary, nextSteps: [], suggestedImprovements: [] }
  }
}

async function renderScreen(p: Project = project()): Promise<void> {
  meshApi().projects.stats.mockResolvedValue({
    sessionCount: 3,
    filesTouchedCount: 5,
    lastActivityAt: '2026-07-13T00:00:00Z'
  })
  render(<ProjectScreen project={p} onBack={vi.fn()} onOpenWorkspace={vi.fn()} />)
  await act(async () => {}) // settle stats / analysis / usage fetches
}

describe('ProjectScreen', () => {
  it('shows the per-Project Usage strip (tokens + Notional Cost)', async () => {
    meshApi().usage.getProjectSummary.mockResolvedValue({
      eventCount: 10,
      sessionCount: 2,
      tokens: 1_500_000,
      costUsd: 12.5
    })
    await renderScreen()
    expect(screen.getByText('1.5M')).toBeInTheDocument()
    expect(screen.getByText('$12.50')).toBeInTheDocument()
  })

  it('keeps the Analysis accordion collapsed by default, expanding on click', async () => {
    meshApi().analyses.latest.mockResolvedValue(okAnalysis('My recent summary'))
    await renderScreen()

    // Collapsed: the summary isn't rendered yet.
    expect(screen.queryByText('My recent summary')).not.toBeInTheDocument()
    const header = screen.getByRole('button', { name: /Analysis/i })
    expect(header).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(header)
    expect(screen.getByText('My recent summary')).toBeInTheDocument()
  })

  it('auto-expands the accordion after a fresh Analyze', async () => {
    meshApi().analyses.latest.mockResolvedValue(null) // not analyzed yet
    meshApi().analyses.run.mockResolvedValue(okAnalysis('Fresh summary'))
    await renderScreen()

    expect(screen.queryByText('Fresh summary')).not.toBeInTheDocument()
    // /^Analyze/ hits the Analyze action, not the accordion's "Analysis …" header.
    await userEvent.click(screen.getByRole('button', { name: /^Analyze/ }))
    expect(await screen.findByText('Fresh summary')).toBeInTheDocument()
  })

  describe('Gate Run', () => {
    it('surfaces the run intent and drops the Analyze bar + Analysis accordion', async () => {
      await renderScreen(gateProject({ intent: 'Build issue #17, the Get directions interaction' }))

      expect(
        screen.getByText('Build issue #17, the Get directions interaction')
      ).toBeInTheDocument()
      // No Analyze action and no Analysis accordion for a Gate Run.
      expect(screen.queryByRole('button', { name: /^Analyze/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Analysis/i })).not.toBeInTheDocument()
      // The analysis fetch is skipped entirely.
      expect(meshApi().analyses.latest).not.toHaveBeenCalled()
    })

    it('falls back to branch then short runId when intent is absent', async () => {
      await renderScreen(gateProject({ intent: null, branch: 'feat/get-directions' }))
      expect(screen.getByText('feat/get-directions')).toBeInTheDocument()
    })

    it('opens the pull request when the run has one', async () => {
      await renderScreen(
        gateProject({ intent: 'Ship the thing', prUrl: 'https://github.com/x/y/pull/17' })
      )
      await userEvent.click(screen.getByRole('button', { name: /pull request/i }))
      expect(meshApi().shell.openExternal).toHaveBeenCalledWith('https://github.com/x/y/pull/17')
    })
  })
})
