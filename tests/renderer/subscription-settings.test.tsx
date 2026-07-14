import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SubscriptionSection } from '@renderer/screens/SettingsScreen'
import { planFeeStore } from '@renderer/hooks/usePlanFee'
import { PLAN_FEE_KEY } from '@renderer/state/plan-fee'
import { meshApi } from './test-utils'

/**
 * Slice 60: the Settings "Subscription" section — a free-form monthly
 * plan-fee field backing Subscription Utilization. Covers the thin
 * renderer surface: reflecting the stored fee, persisting on commit, and
 * clearing when blanked.
 */
describe('SubscriptionSection', () => {
  it('reflects the stored plan fee into the field', () => {
    planFeeStore.setState({ planFeeUsd: 100 })
    render(<SubscriptionSection />)
    expect(screen.getByRole('spinbutton', { name: /monthly plan fee/i })).toHaveValue(100)
  })

  it('persists a typed fee on blur', async () => {
    planFeeStore.setState({ planFeeUsd: null })
    render(<SubscriptionSection />)
    const input = screen.getByRole('spinbutton', { name: /monthly plan fee/i })
    await userEvent.type(input, '50')
    await userEvent.tab() // blur → commit
    expect(meshApi().settings.set).toHaveBeenCalledWith(PLAN_FEE_KEY, '50')
    expect(planFeeStore.getState().planFeeUsd).toBe(50)
  })

  it('clears the fee when the field is blanked', async () => {
    planFeeStore.setState({ planFeeUsd: 20 })
    render(<SubscriptionSection />)
    const input = screen.getByRole('spinbutton', { name: /monthly plan fee/i })
    await userEvent.clear(input)
    await userEvent.tab()
    expect(meshApi().settings.set).toHaveBeenLastCalledWith(PLAN_FEE_KEY, '')
    expect(planFeeStore.getState().planFeeUsd).toBeNull()
  })
})
