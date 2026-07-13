import { render, screen } from '@testing-library/react'
import type { QuotaSnapshot } from '@shared/types'
import { QuotaChip, formatReset } from '@renderer/components/QuotaChip'
import { quotaStore } from '@renderer/hooks/useQuota'

/**
 * Slice 51: the top-bar Quota chip. It reads the singleton quota store
 * (no provider needed to render — the provider only drives refresh), so
 * these tests set store state directly and assert on the rendered
 * gauges. setup.ts resets the store after each test.
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

  it('renders both windows with percent used, and never encodes state in hue alone', () => {
    quotaStore.setState({ enabled: true, snapshot: snapshot() })
    render(<QuotaChip />)

    // The accessible label carries the number + reset — legible without color.
    const fiveHour = screen.getByRole('group', { name: /5-hour window: 15 percent used, resets in/i })
    const weekly = screen.getByRole('group', { name: /Weekly window: 41 percent used, resets in/i })
    expect(fiveHour).toBeInTheDocument()
    expect(weekly).toBeInTheDocument()

    // And the number is rendered as visible text too, not just color.
    expect(screen.getByText('15%')).toBeInTheDocument()
    expect(screen.getByText('41%')).toBeInTheDocument()
  })

  it('rounds and clamps the percentage', () => {
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
