import { describe, it, expect } from 'vitest'
import { rateForModel, tierMultiplier } from '@main/usage/pricing'
import { notionalCost, type TokenGroup } from '@main/usage/cost'

function group(overrides: Partial<TokenGroup> = {}): TokenGroup {
  return {
    model: 'claude-opus-4-8',
    serviceTier: 'standard',
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    ...overrides
  }
}

describe('rateForModel', () => {
  it('matches families across point releases', () => {
    expect(rateForModel('claude-opus-4-8')?.inputPerMTok).toBe(15)
    expect(rateForModel('claude-sonnet-4-6')?.inputPerMTok).toBe(3)
    expect(rateForModel('claude-haiku-4-5')?.inputPerMTok).toBe(1)
  })

  it('returns null for unknown or absent models', () => {
    expect(rateForModel('gpt-4o')).toBeNull()
    expect(rateForModel(null)).toBeNull()
    expect(rateForModel('')).toBeNull()
  })
})

describe('tierMultiplier', () => {
  it('discounts batch, premiums priority, and treats unknown/absent as standard', () => {
    expect(tierMultiplier('standard')).toBe(1)
    expect(tierMultiplier('batch')).toBe(0.5)
    expect(tierMultiplier('priority')).toBe(1.25)
    expect(tierMultiplier('mystery')).toBe(1)
    expect(tierMultiplier(null)).toBe(1)
  })
})

describe('notionalCost', () => {
  it('prices each token class at the model rate', () => {
    // 1M of each class at opus rates: 15 + 75 + 1.5 + 18.75 = 110.25
    const { totalUsd, unpricedModels } = notionalCost([
      group({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000
      })
    ])
    expect(totalUsd).toBeCloseTo(110.25, 5)
    expect(unpricedModels).toEqual([])
  })

  it('applies the service-tier multiplier', () => {
    const { totalUsd } = notionalCost([
      group({ serviceTier: 'batch', inputTokens: 1_000_000, outputTokens: 1_000_000 })
    ])
    // (15 + 75) * 0.5 = 45
    expect(totalUsd).toBeCloseTo(45, 5)
  })

  it('sums across groups', () => {
    const { totalUsd } = notionalCost([
      group({ model: 'claude-haiku-4-5', inputTokens: 1_000_000 }), // $1
      group({ model: 'claude-sonnet-4-6', outputTokens: 1_000_000 }) // $15
    ])
    expect(totalUsd).toBeCloseTo(16, 5)
  })

  it('flags unknown models as unpriced and excludes them from the total', () => {
    const { totalUsd, unpricedModels } = notionalCost([
      group({ model: 'gpt-4o', inputTokens: 1_000_000 }),
      group({ model: null, outputTokens: 5_000_000 })
    ])
    expect(totalUsd).toBe(0)
    expect(unpricedModels.sort()).toEqual(['gpt-4o', 'unknown'])
  })
})
