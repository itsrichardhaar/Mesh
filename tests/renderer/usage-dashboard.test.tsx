import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project, UsageDashboard as UsageDashboardData } from '@shared/types'
import { UsageDashboard } from '@renderer/components/UsageDashboard'
import { usageStore } from '@renderer/hooks/useUsage'
import { meshApi } from './test-utils'

function project(encodedPath: string, name: string): Project {
  return {
    encodedPath,
    sourcePath: `/Users/x/${name}`,
    name,
    autoSubtitle: null,
    activity: '2026-07-13T00:00:00Z',
    sourceMissing: false,
    hidden: false,
    muteNotifications: false
  }
}

function dashboard(overrides: Partial<UsageDashboardData> = {}): UsageDashboardData {
  return {
    summary: {
      eventCount: 100,
      sessionCount: 7,
      sessionsThisMonth: 12,
      totalTokens: 1_500_000,
      totalNotionalCostUsd: 12.34,
      unpricedModels: []
    },
    days: [
      { day: '2026-07-12', tokens: 500_000, costUsd: 5 },
      { day: '2026-07-13', tokens: 1_000_000, costUsd: 7.34 }
    ],
    byProject: [],
    byModel: [],
    topSessions: [],
    ...overrides
  }
}

describe('UsageDashboard', () => {
  it('shows an indexing shimmer before data arrives', () => {
    usageStore.setState({ dashboard: null, indexing: true })
    render(<UsageDashboard />)
    expect(screen.getByText('Indexing your usage…')).toBeInTheDocument()
  })

  it('renders stat cards including Notional Cost with its clarifier', () => {
    usageStore.setState({ dashboard: dashboard(), range: 'all', granularity: 'day', metric: 'tokens' })
    render(<UsageDashboard />)
    expect(screen.getByText('7')).toBeInTheDocument() // sessions
    expect(screen.getByText('1.5M')).toBeInTheDocument() // tokens (compact)
    expect(screen.getByText('$12.34')).toBeInTheDocument()
    expect(screen.getByText(/at API rates — not money spent/i)).toBeInTheDocument()
  })

  it('plots one point per bucket for the active granularity/range', () => {
    usageStore.setState({ dashboard: dashboard(), range: 'all', granularity: 'day', metric: 'tokens' })
    render(<UsageDashboard />)
    const chart = screen.getByRole('img', { name: /usage trend by tokens/i })
    expect(chart).toHaveAttribute('data-points', '2')
  })

  it('switches the plotted metric when the Cost toggle is clicked', async () => {
    usageStore.setState({ dashboard: dashboard(), range: 'all', granularity: 'day', metric: 'tokens' })
    render(<UsageDashboard />)
    await userEvent.click(screen.getByRole('button', { name: 'Cost', pressed: false }))
    expect(screen.getByRole('img', { name: /usage trend by cost/i })).toBeInTheDocument()
  })
})

describe('UsageDashboard — by-project + session explorer (Slice 55)', () => {
  const withRows = (): UsageDashboardData =>
    dashboard({
      byProject: [
        { encodedPath: '-proj-a', tokens: 1_000_000, costUsd: 15, sessionCount: 3, lastActivity: '2026-07-13T00:00:00Z' }
      ],
      topSessions: [
        {
          sessionId: 'sess-abcd1234-ef',
          encodedPath: '-proj-a',
          tokens: 500_000,
          costUsd: 7,
          eventCount: 5,
          lastActivity: '2026-07-13T00:00:00Z',
          model: 'claude-opus-4-8',
          durationMs: 3_600_000
        }
      ]
    })

  it('renders by-project rows by name and selects on click', async () => {
    usageStore.setState({ dashboard: withRows(), range: 'all', metric: 'tokens' })
    const onSelectProject = vi.fn()
    render(<UsageDashboard projects={[project('-proj-a', 'Alpha')]} onSelectProject={onSelectProject} />)
    await userEvent.click(screen.getByRole('button', { name: /Alpha: .* sessions/i }))
    expect(onSelectProject).toHaveBeenCalledWith('-proj-a')
  })

  it('renders the by-model card ranked with its share', () => {
    usageStore.setState({
      dashboard: dashboard({
        byModel: [
          { model: 'claude-opus-4-8', tokens: 3_000_000, costUsd: 30 },
          { model: null, tokens: 1_000_000, costUsd: 0 }
        ]
      }),
      range: 'all',
      metric: 'tokens'
    })
    render(<UsageDashboard />)
    const byModel = screen.getByRole('region', { name: 'By model' })
    expect(within(byModel).getByText('claude-opus-4-8')).toBeInTheDocument()
    expect(within(byModel).getByText('unknown')).toBeInTheDocument() // null model label
    expect(within(byModel).getByText('75%')).toBeInTheDocument() // 3M of 4M
  })

  it('jumps to a session via the three-tier resolver (ptyId null)', async () => {
    usageStore.setState({ dashboard: withRows(), range: 'all', metric: 'tokens' })
    const onJumpToSession = vi.fn()
    render(<UsageDashboard projects={[project('-proj-a', 'Alpha')]} onJumpToSession={onJumpToSession} />)
    await userEvent.click(screen.getByRole('button', { name: 'Jump' }))
    expect(onJumpToSession).toHaveBeenCalledWith({
      encodedPath: '-proj-a',
      sessionId: 'sess-abcd1234-ef',
      ptyId: null
    })
  })

  it('expands a session to its per-turn detail', async () => {
    // Distinct turn model so the assertion doesn't collide with the row's Model cell.
    meshApi().usage.getSessionEvents.mockResolvedValue([
      { eventId: 'e1', timestamp: '2026-07-13T00:00:00Z', model: 'claude-sonnet-4-6', tokens: 1234, costUsd: 0.05 }
    ])
    usageStore.setState({ dashboard: withRows(), range: 'all', metric: 'tokens' })
    render(<UsageDashboard projects={[project('-proj-a', 'Alpha')]} />)
    await userEvent.click(screen.getByRole('button', { expanded: false }))
    expect(await screen.findByText('claude-sonnet-4-6')).toBeInTheDocument()
    expect(meshApi().usage.getSessionEvents).toHaveBeenCalledWith('sess-abcd1234-ef')
  })
})
