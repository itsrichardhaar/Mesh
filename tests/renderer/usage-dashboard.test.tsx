import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MetricCards, Project, UsageDashboard as UsageDashboardData } from '@shared/types'
import { UsageDashboard } from '@renderer/components/UsageDashboard'
import { usageStore } from '@renderer/hooks/useUsage'
import { meshApi } from './test-utils'

/** Global Metric Cards fixture (Slice 72), overridable per-test. */
function cards(overrides: Partial<MetricCards> = {}): MetricCards {
  return {
    today: { tokens: 300_000, sessions: 3 },
    sevenDay: { tokens: 900_000, activeDays: 5 },
    month: { tokens: 1_500_000, activeDays: 10, avgPerActiveDay: 150_000 },
    subscription: null,
    ...overrides
  }
}

function project(encodedPath: string, name: string): Project {
  return {
    encodedPath,
    sourcePath: `/Users/x/${name}`,
    name,
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
    metricCards: cards(),
    days: [
      // 10/20/60/10 class split so composition shares are exact.
      { day: '2026-07-12', tokens: 500_000, costUsd: 5, inputTokens: 50_000, outputTokens: 100_000, cacheReadTokens: 300_000, cacheWriteTokens: 50_000 },
      { day: '2026-07-13', tokens: 1_000_000, costUsd: 7.34, inputTokens: 100_000, outputTokens: 200_000, cacheReadTokens: 600_000, cacheWriteTokens: 100_000 }
    ],
    heatmapDays: [],
    byProject: [],
    byModel: [],
    topSessions: [],
    sessionsTotal: 0
  }
  const merged = { ...base, ...overrides }
  // The Activity Heatmap + Subscription Utilization read the global
  // `heatmapDays`; default it to the effective `days` unless overridden.
  // `sessionsTotal` defaults to the shown session count (no truncation).
  return {
    ...merged,
    heatmapDays: overrides.heatmapDays ?? merged.days,
    sessionsTotal: overrides.sessionsTotal ?? merged.topSessions.length
  }
}

describe('UsageDashboard', () => {
  it('shows an indexing shimmer before data arrives', () => {
    usageStore.setState({ dashboard: null, indexing: true })
    render(<UsageDashboard />)
    expect(screen.getByText('Indexing your usage…')).toBeInTheDocument()
  })

  it('renders the four global metric cards (Today / 7-day / month)', () => {
    usageStore.setState({ dashboard: dashboard(), timeframe: 'all', granularity: 'day', metric: 'tokens' })
    render(<UsageDashboard />)
    // Labels + distinctive sub-captions prove each card's data (the compact
    // token values collide with the Token Composition card, so assert the subs).
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('3 sessions')).toBeInTheDocument()
    expect(screen.getByText('Last 7 days')).toBeInTheDocument()
    expect(screen.getByText('5 active days')).toBeInTheDocument()
    expect(screen.getByText('This month')).toBeInTheDocument()
    expect(screen.getByText('150K avg / active day')).toBeInTheDocument()
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
          startedAt: '2026-07-12T23:00:00Z',
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

  it('shows a set-your-fee hint when Subscription is null (no plan fee)', () => {
    usageStore.setState({
      dashboard: dashboard({ metricCards: cards({ subscription: null }) }),
      timeframe: 'all',
      metric: 'tokens'
    })
    render(<UsageDashboard />)
    const region = screen.getByRole('region', { name: 'Subscription Utilization' })
    expect(within(region).getByText(/set your monthly plan fee/i)).toBeInTheDocument()
  })

  it('reads "N× your plan fee" with the notional-vs-fee detail (v10)', () => {
    usageStore.setState({
      dashboard: dashboard({
        metricCards: cards({ subscription: { notionalUsd: 12, feeUsd: 20, multiple: 0.6 } })
      }),
      timeframe: 'all',
      metric: 'tokens'
    })
    render(<UsageDashboard />)
    const region = screen.getByRole('region', { name: /Subscription Utilization/i })
    expect(within(region).getByText('0.6×')).toBeInTheDocument()
    expect(within(region).getByText('your plan fee')).toBeInTheDocument()
    expect(within(region).getByText(/\$12\.00 vs \$20\.00/)).toBeInTheDocument()
    // Bar length reinforces the multiple: 0.6 / 3 = 20%.
    const fill = region.querySelector('.usage-metric-fill') as HTMLElement
    expect(fill.style.width).toBe('20%')
  })

  it('caps the Subscription bar fill at 3× (min(multiple/3, 1))', () => {
    usageStore.setState({
      dashboard: dashboard({
        metricCards: cards({ subscription: { notionalUsd: 50, feeUsd: 10, multiple: 5 } })
      }),
      timeframe: 'all',
      metric: 'tokens'
    })
    render(<UsageDashboard />)
    const region = screen.getByRole('region', { name: /Subscription Utilization/i })
    expect(within(region).getByText('5.0×')).toBeInTheDocument()
    const fill = region.querySelector('.usage-metric-fill') as HTMLElement
    expect(fill.style.width).toBe('100%') // 5/3 clamps to full
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

  it('notes "Showing N of M" when the sessions backstop truncates (v10)', () => {
    const sessions = Array.from({ length: 3 }, (_, i) => ({
      sessionId: `sess-000${i}`,
      encodedPath: '-proj-a',
      tokens: 100,
      costUsd: 1,
      eventCount: 1,
      startedAt: `2026-07-1${i}T00:00:00Z`,
      lastActivity: `2026-07-1${i}T00:00:00Z`,
      model: 'claude-opus-4-8',
      durationMs: 1000
    }))
    usageStore.setState({
      dashboard: dashboard({ topSessions: sessions, sessionsTotal: 42 }),
      timeframe: 'month',
      metric: 'tokens'
    })
    render(<UsageDashboard projects={[project('-proj-a', 'Alpha')]} />)
    const region = screen.getByRole('region', { name: 'Recent sessions' })
    expect(within(region).getByText('Showing 3 of 42')).toBeInTheDocument()
  })

  it('shows the plain filtered session count when not truncated (v10)', () => {
    usageStore.setState({ dashboard: withRows(), timeframe: 'month', metric: 'tokens' })
    render(<UsageDashboard projects={[project('-proj-a', 'Alpha')]} />)
    const region = screen.getByRole('region', { name: 'Recent sessions' })
    expect(within(region).getByText('1 session')).toBeInTheDocument()
  })

  it('expands a session to its summary, fetched lazily', async () => {
    meshApi().usage.getSessionSummary.mockResolvedValue('Wired up the login flow and fixed the redirect.')
    usageStore.setState({ dashboard: withRows(), timeframe: 'all', metric: 'tokens' })
    render(<UsageDashboard projects={[project('-proj-a', 'Alpha')]} />)
    await userEvent.click(screen.getByRole('button', { expanded: false }))
    expect(
      await screen.findByText('Wired up the login flow and fixed the redirect.')
    ).toBeInTheDocument()
    expect(meshApi().usage.getSessionSummary).toHaveBeenCalledWith('-proj-a', 'sess-abcd1234-ef')
  })

  it('shows an empty note when a session has no summary', async () => {
    meshApi().usage.getSessionSummary.mockResolvedValue(null)
    usageStore.setState({ dashboard: withRows(), timeframe: 'all', metric: 'tokens' })
    render(<UsageDashboard projects={[project('-proj-a', 'Alpha')]} />)
    await userEvent.click(screen.getByRole('button', { expanded: false }))
    expect(await screen.findByText(/No summary was recorded/i)).toBeInTheDocument()
  })

  it('shows the session start date/time', () => {
    usageStore.setState({ dashboard: withRows(), timeframe: 'all', metric: 'tokens' })
    render(<UsageDashboard projects={[project('-proj-a', 'Alpha')]} />)
    const region = screen.getByRole('region', { name: 'Recent sessions' })
    // startedAt 2026-07-12T23:00:00Z formats to a "Jul 12" (or local-tz) date label.
    expect(within(region).getByText(/Jul 1[23],/)).toBeInTheDocument()
  })

  describe('Worktree Run sessions', () => {
    const gateRun = (): Project => ({
      ...project('-run-xyz', '01M35ATS3JQH6KA3G5VF89H2NS'),
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
        intent: 'Ship the gate run summary on the Project Screen.'
      }
    })

    const gateSessions = (): UsageDashboardData =>
      dashboard({
        topSessions: [
          {
            sessionId: 'sess-gate01-ab',
            encodedPath: '-run-xyz',
            tokens: 100,
            costUsd: 1,
            eventCount: 1,
            startedAt: '2026-07-12T23:00:00Z',
            lastActivity: '2026-07-13T00:00:00Z',
            model: 'claude-opus-4-8',
            durationMs: 1000
          }
        ]
      })

    it('shows the Parent Project name and a no-mistakes tag instead of the ULID', () => {
      usageStore.setState({ dashboard: gateSessions(), timeframe: 'all', metric: 'tokens' })
      render(<UsageDashboard projects={[project('-proj-a', 'Alpha'), gateRun()]} />)
      const region = screen.getByRole('region', { name: 'Recent sessions' })
      expect(within(region).getByText('Alpha')).toBeInTheDocument()
      expect(within(region).getByText('no-mistakes')).toBeInTheDocument()
      expect(within(region).queryByText('01M35ATS3JQH6KA3G5VF89H2NS')).not.toBeInTheDocument()
    })

    it('uses the gate intent as the summary without a round-trip', async () => {
      usageStore.setState({ dashboard: gateSessions(), timeframe: 'all', metric: 'tokens' })
      render(<UsageDashboard projects={[project('-proj-a', 'Alpha'), gateRun()]} />)
      await userEvent.click(screen.getByRole('button', { expanded: false }))
      expect(
        await screen.findByText('Ship the gate run summary on the Project Screen.')
      ).toBeInTheDocument()
      expect(meshApi().usage.getSessionSummary).not.toHaveBeenCalled()
    })
  })
})
