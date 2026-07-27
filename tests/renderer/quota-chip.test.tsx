import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { QuotaSnapshot } from '@shared/types'
import { QuotaChip, formatReset } from '@renderer/components/QuotaChip'
import { quotaStore } from '@renderer/hooks/useQuota'

/**
 * Slice 51 + Slice 73: the top-bar Quota chip. It reads the singleton
 * quota store (no provider needed to render — the provider only drives
 * refresh), so these tests set store state directly and assert on the
 * rendered gauges + dropdown. setup.ts resets the store after each test.
 */

function snapshot(overrides: Partial<QuotaSnapshot> = {}): QuotaSnapshot {
  return {
    provider: 'claude',
    fetchedAt: '2026-07-13T12:00:00.000Z',
    windows: [
      { kind: 'five_hour', label: '5-hour window', percentUsed: 15, resetsAt: '2099-01-01T00:00:00Z' },
      { kind: 'seven_day', label: 'Weekly window', percentUsed: 41, resetsAt: '2099-01-01T00:00:00Z' }
    ],
    ...overrides
  }
}

describe('QuotaChip', () => {
  it('renders nothing while the feature is disabled', () => {
    quotaStore.setState({ enabled: false, snapshot: snapshot() })
    const { container } = render(<QuotaChip />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when enabled but the snapshot is null (unavailable/failed)', () => {
    quotaStore.setState({ enabled: true, snapshot: null })
    const { container } = render(<QuotaChip />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders both inline bars as one toggle, summarizing both windows without hue', () => {
    quotaStore.setState({ enabled: true, snapshot: snapshot() })
    render(<QuotaChip />)

    // A single dialog-toggle whose accessible label carries both numbers.
    const toggle = screen.getByRole('button', { name: /Claude Code Quota:.*5-hour window 15% used.*Weekly window 41% used/i })
    expect(toggle).toHaveAttribute('aria-haspopup', 'dialog')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    // The numbers are rendered as visible text too, not just color.
    expect(screen.getByText('15%')).toBeInTheDocument()
    expect(screen.getByText('41%')).toBeInTheDocument()
  })

  it('rounds and clamps the inline percentage', () => {
    quotaStore.setState({
      enabled: true,
      snapshot: snapshot({
        windows: [
          { kind: 'five_hour', label: '5-hour window', percentUsed: 15.7, resetsAt: '2099-01-01T00:00:00Z' },
          { kind: 'seven_day', label: 'Weekly window', percentUsed: 130, resetsAt: '2099-01-01T00:00:00Z' }
        ]
      })
    })
    render(<QuotaChip />)
    expect(screen.getByText('16%')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('opens one dropdown from the bars showing both windows with reset / used / remaining', async () => {
    quotaStore.setState({ enabled: true, snapshot: snapshot() })
    render(<QuotaChip />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Claude Code Quota:/i }))

    const dialog = screen.getByRole('dialog', { name: 'Claude Code Quota' })
    expect(within(dialog).getByText('Claude Code Quota')).toBeInTheDocument()
    expect(within(dialog).getByText('live · subscription')).toBeInTheDocument()

    // Both windows, each with used + remaining (= 100 − used) + reset.
    const fiveHour = within(dialog).getByRole('group', {
      name: /5-hour window: 15 percent used, 85 percent remaining, resets in/i
    })
    const weekly = within(dialog).getByRole('group', {
      name: /Weekly window: 41 percent used, 59 percent remaining, resets in/i
    })
    expect(within(fiveHour).getByText('15% used')).toBeInTheDocument()
    expect(within(fiveHour).getByText('85% left')).toBeInTheDocument()
    expect(within(weekly).getByText('59% left')).toBeInTheDocument()
  })

  it('clamps % remaining at 0 when a window is over 100% used', async () => {
    quotaStore.setState({
      enabled: true,
      snapshot: snapshot({
        windows: [
          { kind: 'five_hour', label: '5-hour window', percentUsed: 130, resetsAt: '2099-01-01T00:00:00Z' },
          { kind: 'seven_day', label: 'Weekly window', percentUsed: 41, resetsAt: '2099-01-01T00:00:00Z' }
        ]
      })
    })
    render(<QuotaChip />)
    await userEvent.click(screen.getByRole('button', { name: /Claude Code Quota:/i }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('0% left')).toBeInTheDocument()
  })

  it('dismisses the dropdown on Escape', async () => {
    quotaStore.setState({ enabled: true, snapshot: snapshot() })
    render(<QuotaChip />)
    await userEvent.click(screen.getByRole('button', { name: /Claude Code Quota:/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('dismisses the dropdown on outside click', async () => {
    quotaStore.setState({ enabled: true, snapshot: snapshot() })
    render(
      <div>
        <button type="button">outside</button>
        <QuotaChip />
      </div>
    )
    await userEvent.click(screen.getByRole('button', { name: /Claude Code Quota:/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'outside' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('formatReset', () => {
  const now = Date.parse('2026-07-13T12:00:00Z')

  it('formats minutes-only', () => {
    expect(formatReset('2026-07-13T12:41:00Z', now)).toBe('resets in 41m')
  })

  it('formats hours and minutes', () => {
    expect(formatReset('2026-07-13T14:41:00Z', now)).toBe('resets in 2h 41m')
  })

  it('formats days and hours', () => {
    expect(formatReset('2026-07-15T18:00:00Z', now)).toBe('resets in 2d 6h')
  })

  it('collapses past-due and unparseable timestamps to "resets soon"', () => {
    expect(formatReset('2026-07-13T11:59:00Z', now)).toBe('resets soon')
    expect(formatReset('not-a-date', now)).toBe('resets soon')
  })
})
