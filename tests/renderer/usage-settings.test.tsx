import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UsageSection } from '@renderer/screens/SettingsScreen'
import { meshApi, meshEmit } from './test-utils'

/**
 * Slice 52: the Settings "Usage data" section — reads ingest status and
 * exposes a manual Rebuild. The heavy ingest logic is main-process
 * (node-tested); this covers the thin renderer surface: status readout,
 * the rebuild action calling IPC, and live status updates.
 */
async function renderSection(): Promise<void> {
  render(<UsageSection />)
  await act(async () => {}) // settle the initial getStatus fetch
}

describe('UsageSection', () => {
  it('shows the indexed event count from getStatus', async () => {
    meshApi().usage.getStatus.mockResolvedValue({ state: 'idle', eventCount: 1234 })
    await renderSection()
    expect(screen.getByText('1,234 usage events indexed')).toBeInTheDocument()
  })

  it('shows Notional Cost with the "not money spent" clarifier', async () => {
    meshApi().usage.getStatus.mockResolvedValue({ state: 'idle', eventCount: 10 })
    meshApi().usage.getCostSummary.mockResolvedValue({
      totalNotionalCostUsd: 42.5,
      unpricedModels: []
    })
    await renderSection()
    expect(screen.getByText(/≈ \$42\.50/)).toBeInTheDocument()
    expect(screen.getByText(/at API rates — not money spent/i)).toBeInTheDocument()
  })

  it('calls usage.rebuild when the Rebuild button is clicked', async () => {
    meshApi().usage.getStatus.mockResolvedValue({ state: 'idle', eventCount: 10 })
    await renderSection()
    await userEvent.click(screen.getByRole('button', { name: /rebuild usage index/i }))
    expect(meshApi().usage.rebuild).toHaveBeenCalledOnce()
  })

  it('reflects live status changes: indexing disables the button, then the new count shows', async () => {
    meshApi().usage.getStatus.mockResolvedValue({ state: 'idle', eventCount: 5 })
    await renderSection()
    expect(screen.getByText('5 usage events indexed')).toBeInTheDocument()

    act(() => meshEmit().usageStatusChanged({ state: 'indexing', eventCount: 5 }))
    expect(screen.getByText('Indexing…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /rebuilding…/i })).toBeDisabled()

    act(() => meshEmit().usageStatusChanged({ state: 'idle', eventCount: 8 }))
    expect(screen.getByText('8 usage events indexed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /rebuild usage index/i })).toBeEnabled()
  })
})
