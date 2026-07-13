import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UsageDashboard as UsageDashboardData } from '@shared/types'
import { UsageDashboard } from '@renderer/components/UsageDashboard'
import { usageStore } from '@renderer/hooks/useUsage'

function dashboard(overrides: Partial<UsageDashboardData> = {}): UsageDashboardData {
  return {
    summary: {
      eventCount: 100,
      sessionCount: 7,
      totalTokens: 1_500_000,
      totalNotionalCostUsd: 12.34,
      unpricedModels: []
    },
    days: [
      { day: '2026-07-12', tokens: 500_000, costUsd: 5 },
      { day: '2026-07-13', tokens: 1_000_000, costUsd: 7.34 }
    ],
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
