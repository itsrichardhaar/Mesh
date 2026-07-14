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
    muteNotifications: false
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

async function renderScreen(): Promise<void> {
  meshApi().projects.stats.mockResolvedValue({
    sessionCount: 3,
    filesTouchedCount: 5,
    lastActivityAt: '2026-07-13T00:00:00Z'
  })
  render(<ProjectScreen project={project()} onBack={vi.fn()} onOpenWorkspace={vi.fn()} />)
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
})
