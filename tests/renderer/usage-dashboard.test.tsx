import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Project, UsageDashboard as UsageDashboardData } from '@shared/types'
import { UsageDashboard } from '@renderer/components/UsageDashboard'
import { usageStore } from '@renderer/hooks/useUsage'
import { planFeeStore } from '@renderer/hooks/usePlanFee'
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
  const base: UsageDashboardData = {
    summary: {
      eventCount: 100,
      sessionCount: 7,
      sessionsThisMonth: 12,
      totalTokens: 1_500_000,
      totalNotionalCostUsd: 12.34,
      unpricedModels: []
    },
    days: [
      // 10/20/60/10 class split so composition shares are exact.
      { day: '2026-07-12', tokens: 500_000, costUsd: 5, inputTokens: 50_000, outputTokens: 100_000, cacheReadTokens: 300_000, cacheWriteTokens: 50_000 },
      { day: '2026-07-13', tokens: 1_000_000, costUsd: 7.34, inputTokens: 100_000, outputTokens: 200_000, cacheReadTokens: 600_000, cacheWriteTokens: 100_000 }
    ],
    heatmapDays: [],
    byProject: [],
    byModel: [],
    topSessions: []
  }
  const merged = { ...base, ...overrides }
  // The Activity Heatmap + Subscription Utilization read the global
  // `heatmapDays`; default it to the effective `days` unless overridden.
  return { ...merged, heatmapDays: overrides.heatmapDays ?? merged.days }
}

describe('UsageDashboard', () => {
  it('shows an indexing shimmer before data arrives', () => {
    usageStore.setState({ dashboard: null, indexing: true })
    render(<UsageDashboard />)
    expect(screen.getByText('Indexing your usage…')).toBeInTheDocument()
  })

  it('renders stat cards including Notional Cost with its clarifier', () => {
    usageStore.setState({ dashboard: dashboard(), timeframe: 'all', granularity: 'day', metric: 'tokens' })
    render(<UsageDashboard />)
    expect(screen.getByText('7')).toBeInTheDocument() // sessions
    expect(screen.getByText('1.5M')).toBeInTheDocument() // tokens (compact)
    expect(screen.getByText('$12.34')).toBeInTheDocument()
    expect(screen.getByText(/at API rates — not money spent/i)).toBeInTheDocument()
  })

  it('plots one point per bucket for the active granularity/range', () => {
    usageStore.setState({ dashboard: dashboard(), timeframe: 'all', granularity: 'day', metric: 'tokens' })
    render(<UsageDashboard />)
    const chart = screen.getByRole('img', { name: /usage trend by tokens/i })
    expect(chart).toHaveAttribute('data-points', '2')
  })

  it('switches the plotted metric when the Cost toggle is clicked', async () => {
    usageStore.setState({ dashboard: dashboard(), timeframe: 'all', granularity: 'day', metric: 'tokens' })
    render(<UsageDashboard />)
    await userEvent.click(screen.getByRole('button', { name: 'Cost', pressed: false }))
    expect(screen.getByRole('img', { name: /usage trend by cost/i })).toBeInTheDocument()
  })

  it('toggles to the heatmap, hiding granularity but keeping metric + range', async () => {
    usageStore.setState({ dashboard: dashboard(), timeframe: 'all', granularity: 'day', metric: 'tokens' })
    render(<UsageDashboard />)
    // Trend is the default view: trend chart + granularity control present.
    expect(screen.getByRole('img', { name: /usage trend by tokens/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Week' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Heatmap' }))

    // Heatmap swaps in; trend + granularity gone; metric + range stay.
    expect(screen.getByRole('img', { name: /activity heatmap by tokens/i })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /usage trend/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Week' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cost' })).toBeInTheDocument() // metric toggle stays
    expect(screen.getByRole('combobox', { name: 'Timeframe' })).toBeInTheDocument() // range stays (drives composition)
  })

  it('shades the heatmap by the active metric', async () => {
    usageStore.setState({ dashboard: dashboard(), timeframe: 'all', granularity: 'day', metric: 'tokens' })
    render(<UsageDashboard />)
    await userEvent.click(screen.getByRole('button', { name: 'Cost' }))
    await userEvent.click(screen.getByRole('button', { name: 'Heatmap' }))
    expect(screen.getByRole('img', { name: /activity heatmap by cost/i })).toBeInTheDocument()
  })

  it('re-fetches with the new timeframe when the Timeframe dropdown changes (v10)', async () => {
    usageStore.setState({ dashboard: dashboard(), timeframe: 'month', granularity: 'day', metric: 'tokens' })
    render(<UsageDashboard />)
    meshApi().usage.getDashboard.mockClear()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Timeframe' }), 'all')
    expect(meshApi().usage.getDashboard).toHaveBeenCalledWith({ timeframe: 'all', encodedPath: null })
  })

  it('does NOT re-fetch when the metric toggle changes (client-side, v10)', async () => {
    usageStore.setState({ dashboard: dashboard(), timeframe: 'month', granularity: 'day', metric: 'tokens' })
    render(<UsageDashboard />)
    meshApi().usage.getDashboard.mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'Cost' }))
    expect(meshApi().usage.getDashboard).not.toHaveBeenCalled()
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
    usageStore.setState({ dashboard: withRows(), timeframe: 'all', metric: 'tokens' })
    const onSelectProject = vi.fn()
    render(<UsageDashboard projects={[project('-proj-a', 'Alpha')]} onSelectProject={onSelectProject} />)
    await userEvent.click(screen.getByRole('button', { name: /Alpha: .* sessions/i }))
    expect(onSelectProject).toHaveBeenCalledWith('-proj-a')
  })

  it('re-fetches scoped to the Project when the Project dropdown changes (v10)', async () => {
    usageStore.setState({ dashboard: withRows(), timeframe: 'month', project: null, metric: 'tokens' })
    render(<UsageDashboard projects={[project('-proj-a', 'Alpha')]} />)
    meshApi().usage.getDashboard.mockClear()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project' }), '-proj-a')
    expect(meshApi().usage.getDashboard).toHaveBeenCalledWith({
      timeframe: 'month',
      encodedPath: '-proj-a'
    })
  })

  it('hides the By-project breakdown when a Project is selected, keeping By-model (v10)', () => {
    const scoped = dashboard({
      byProject: [
        { encodedPath: '-proj-a', tokens: 1_000_000, costUsd: 15, sessionCount: 3, lastActivity: '2026-07-13T00:00:00Z' }
      ],
      byModel: [{ model: 'claude-opus-4-8', tokens: 1_000_000, costUsd: 15 }]
    })
    usageStore.setState({ dashboard: scoped, timeframe: 'month', project: '-proj-a', metric: 'tokens' })
    render(<UsageDashboard projects={[project('-proj-a', 'Alpha')]} />)
    expect(screen.queryByRole('region', { name: 'By project' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'By model' })).toBeInTheDocument()
  })

  it('shows the By-project breakdown when no Project is selected (v10)', () => {
    usageStore.setState({ dashboard: withRows(), timeframe: 'month', project: null, metric: 'tokens' })
    render(<UsageDashboard projects={[project('-proj-a', 'Alpha')]} />)
    expect(screen.getByRole('region', { name: 'By project' })).toBeInTheDocument()
  })

  it('caps By project at the top 5, with shares relative to all projects', () => {
    // 7 projects; top = 1M of a 2M grand total. Tail (p6, p7) must be hidden,
    // and the top row must read 50% (over the full 2M) — not 56% (over the
    // visible-5 sum of 1.8M) — proving shares stay relative to every project.
    const tokens = [1_000_000, 400_000, 200_000, 100_000, 100_000, 100_000, 100_000]
    const byProject = tokens.map((t, i) => ({
      encodedPath: `-p${i + 1}`,
      tokens: t,
      costUsd: 0,
      sessionCount: 1,
      lastActivity: '2026-07-13T00:00:00Z'
    }))
    const projects = tokens.map((_, i) => project(`-p${i + 1}`, `P${i + 1}`))
    usageStore.setState({ dashboard: dashboard({ byProject }), timeframe: 'all', metric: 'tokens' })
    render(<UsageDashboard projects={projects} />)

    const region = screen.getByRole('region', { name: 'By project' })
    expect(within(region).getAllByRole('button')).toHaveLength(5) // one button per visible row
    expect(within(region).getByText('P1')).toBeInTheDocument()
    expect(within(region).queryByText('P6')).not.toBeInTheDocument() // tail hidden
    expect(within(region).queryByText('P7')).not.toBeInTheDocument()
    expect(within(region).getByText('50%')).toBeInTheDocument() // 1M of the full 2M, not 1.8M
  })

  // A dashboard whose only day is today, so the current-calendar-month
  // sum is deterministic regardless of when the suite runs.
  const dashboardToday = (costUsd: number): UsageDashboardData => {
    const today = new Date().toISOString().slice(0, 10)
    return dashboard({
      days: [
        { day: today, tokens: 1_000, costUsd, inputTokens: 100, outputTokens: 200, cacheReadTokens: 600, cacheWriteTokens: 100 }
      ]
    })
  }

  it('hides the Subscription Utilization gauge until a plan fee is set', () => {
    planFeeStore.setState({ planFeeUsd: null })
    usageStore.setState({ dashboard: dashboard(), timeframe: 'all', metric: 'tokens' })
    render(<UsageDashboard />)
    const region = screen.getByRole('region', { name: 'Subscription Utilization' })
    expect(within(region).getByText(/set your monthly plan fee/i)).toBeInTheDocument()
  })

  it('shows the utilization percent against the plan fee when set', () => {
    planFeeStore.setState({ planFeeUsd: 20 })
    usageStore.setState({ dashboard: dashboardToday(12), timeframe: 'all', metric: 'tokens' })
    render(<UsageDashboard />)
    const region = screen.getByRole('region', { name: 'Subscription Utilization' })
    expect(within(region).getByText('60%')).toBeInTheDocument() // 12 of 20
  })

  it('reads “Paying off” when this month beats the fee', () => {
    planFeeStore.setState({ planFeeUsd: 10 })
    usageStore.setState({ dashboard: dashboardToday(25), timeframe: 'all', metric: 'tokens' })
    render(<UsageDashboard />)
    const region = screen.getByRole('region', { name: 'Subscription Utilization' })
    expect(within(region).getByText('250%')).toBeInTheDocument()
    expect(within(region).getByText(/Paying off/)).toBeInTheDocument()
  })

  it('renders the token composition card with class shares over the range', () => {
    usageStore.setState({ dashboard: dashboard(), timeframe: 'all', metric: 'tokens' })
    render(<UsageDashboard />)
    const comp = screen.getByRole('region', { name: 'Token composition' })
    // 10/20/60/10 split across the two fixture days → shares independent of the metric toggle.
    expect(within(comp).getByText('Cache read')).toBeInTheDocument()
    expect(within(comp).getByText('60%')).toBeInTheDocument() // cache-read dominates
    expect(within(comp).getByText('Input')).toBeInTheDocument()
    expect(within(comp).getAllByText('10%')).toHaveLength(2) // input + cache-write
  })

  it('renders the by-model card ranked with its share', () => {
    usageStore.setState({
      dashboard: dashboard({
        byModel: [
          { model: 'claude-opus-4-8', tokens: 3_000_000, costUsd: 30 },
          { model: null, tokens: 1_000_000, costUsd: 0 }
        ]
      }),
      timeframe: 'all',
      metric: 'tokens'
    })
    render(<UsageDashboard />)
    const byModel = screen.getByRole('region', { name: 'By model' })
    expect(within(byModel).getByText('claude-opus-4-8')).toBeInTheDocument()
    expect(within(byModel).getByText('unknown')).toBeInTheDocument() // null model label
    expect(within(byModel).getByText('75%')).toBeInTheDocument() // 3M of 4M
  })

  it('jumps to a session via the three-tier resolver (ptyId null)', async () => {
    usageStore.setState({ dashboard: withRows(), timeframe: 'all', metric: 'tokens' })
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
    usageStore.setState({ dashboard: withRows(), timeframe: 'all', metric: 'tokens' })
    render(<UsageDashboard projects={[project('-proj-a', 'Alpha')]} />)
    await userEvent.click(screen.getByRole('button', { expanded: false }))
    expect(await screen.findByText('claude-sonnet-4-6')).toBeInTheDocument()
    expect(meshApi().usage.getSessionEvents).toHaveBeenCalledWith('sess-abcd1234-ef')
  })
})
