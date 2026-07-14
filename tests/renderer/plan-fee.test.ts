import { vi } from 'vitest'
import { createPlanFeeStore, PLAN_FEE_KEY } from '@renderer/state/plan-fee'

/** A minimal settings k/v fake holding one value. */
function fakeSettings(initial: string | null = null) {
  const box = { value: initial }
  return {
    get: vi.fn(async () => box.value),
    set: vi.fn(async (_key: string, value: string) => {
      box.value = value
    })
  }
}

describe('planFeeStore', () => {
  it('loads and parses a positive fee', async () => {
    const settings = fakeSettings('100')
    const store = createPlanFeeStore({ settings: () => settings })
    await store.getState().load()
    expect(store.getState().planFeeUsd).toBe(100)
    expect(settings.get).toHaveBeenCalledWith(PLAN_FEE_KEY)
  })

  it('treats blank / invalid / non-positive as unset', async () => {
    for (const raw of ['', 'abc', '0', '-5']) {
      const store = createPlanFeeStore({ settings: () => fakeSettings(raw) })
      await store.getState().load()
      expect(store.getState().planFeeUsd).toBeNull()
    }
  })

  it('persists a set fee and clears on null', async () => {
    const settings = fakeSettings(null)
    const store = createPlanFeeStore({ settings: () => settings })

    await store.getState().setPlanFee(20)
    expect(store.getState().planFeeUsd).toBe(20)
    expect(settings.set).toHaveBeenCalledWith(PLAN_FEE_KEY, '20')

    await store.getState().setPlanFee(null)
    expect(store.getState().planFeeUsd).toBeNull()
    expect(settings.set).toHaveBeenLastCalledWith(PLAN_FEE_KEY, '')
  })

  it('rejects a non-positive setPlanFee value as unset', async () => {
    const settings = fakeSettings(null)
    const store = createPlanFeeStore({ settings: () => settings })
    await store.getState().setPlanFee(-3)
    expect(store.getState().planFeeUsd).toBeNull()
    expect(settings.set).toHaveBeenLastCalledWith(PLAN_FEE_KEY, '')
  })
})
