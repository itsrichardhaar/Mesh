import { describe, it, expect } from 'vitest'
import {
  PROVIDERS,
  findModel,
  getRecommendedModel,
  isModelId,
  selectedModelSettingKey
} from '@shared/models'

/**
 * Catalog-shape tests for `shared/models.ts`. v4 Slice 35 flips
 * `openai.available` true and populates the OpenAI Provider with
 * three `ModelDescriptor` entries; these tests pin that shape so a
 * mistaken edit (e.g. accidentally removing the recommended flag,
 * adding a fourth tier without intent, dropping a model ID) breaks
 * the test rather than silently changing what Settings → Model shows.
 */
describe('PROVIDERS catalog', () => {
  it('exposes the three Provider slots', () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual(['claude', 'local', 'openai'])
  })

  describe('claude', () => {
    it('is available with three models', () => {
      expect(PROVIDERS.claude.available).toBe(true)
      expect(PROVIDERS.claude.models).toHaveLength(3)
    })

    it('recommends Haiku 4.5', () => {
      const rec = getRecommendedModel('claude')
      expect(rec?.id).toBe('claude-haiku-4-5')
    })
  })

  describe('openai (Slice 35)', () => {
    it('flipped from stub to available', () => {
      expect(PROVIDERS.openai.available).toBe(true)
    })

    it('no longer carries the `comingSoonNote` placeholder', () => {
      expect(PROVIDERS.openai.comingSoonNote).toBeUndefined()
    })

    it('has three models — fast / balanced / most capable', () => {
      expect(PROVIDERS.openai.models).toHaveLength(3)
      const ids = PROVIDERS.openai.models.map((m) => m.id)
      expect(ids).toEqual(['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'])
    })

    it('recommends gpt-4o-mini (mirrors Claude\'s "fast & cheap" default)', () => {
      const rec = getRecommendedModel('openai')
      expect(rec?.id).toBe('gpt-4o-mini')
      expect(rec?.recommended).toBe(true)
    })

    it('marks exactly one model as recommended', () => {
      const recs = PROVIDERS.openai.models.filter((m) => m.recommended === true)
      expect(recs).toHaveLength(1)
    })

    it('attaches a positive per-Analysis cost estimate to each model', () => {
      for (const m of PROVIDERS.openai.models) {
        expect(m.approxCostPerAnalysisUSD).toBeGreaterThan(0)
      }
    })

    it('orders models cheapest → most expensive', () => {
      const costs = PROVIDERS.openai.models.map((m) => m.approxCostPerAnalysisUSD)
      const sorted = [...costs].sort((a, b) => a - b)
      expect(costs).toEqual(sorted)
    })
  })

  describe('local', () => {
    it('stays unavailable with the neutralized tooltip', () => {
      expect(PROVIDERS.local.available).toBe(false)
      expect(PROVIDERS.local.comingSoonNote).toBe('Coming soon')
      expect(PROVIDERS.local.models).toHaveLength(0)
    })
  })
})

describe('isModelId / findModel', () => {
  it('recognizes Claude IDs', () => {
    expect(isModelId('claude-haiku-4-5')).toBe(true)
    expect(isModelId('claude-opus-4-7')).toBe(true)
  })

  it('recognizes OpenAI IDs added in Slice 35', () => {
    expect(isModelId('gpt-4o-mini')).toBe(true)
    expect(isModelId('gpt-4o')).toBe(true)
    expect(isModelId('gpt-4-turbo')).toBe(true)
  })

  it('rejects unknown strings', () => {
    expect(isModelId('claude-foo')).toBe(false)
    expect(isModelId('gpt-5')).toBe(false)
    expect(isModelId('')).toBe(false)
    expect(isModelId(42)).toBe(false)
    expect(isModelId(null)).toBe(false)
  })

  it('finds models by ID across both Providers', () => {
    expect(findModel('claude-haiku-4-5')?.label).toBe('Haiku 4.5')
    expect(findModel('gpt-4o-mini')?.label).toBe('GPT-4o mini')
    expect(findModel('not-a-model')).toBeNull()
  })
})

describe('selectedModelSettingKey', () => {
  it('namespaces by Provider', () => {
    expect(selectedModelSettingKey('claude')).toBe('model:claude')
    expect(selectedModelSettingKey('openai')).toBe('model:openai')
    expect(selectedModelSettingKey('local')).toBe('model:local')
  })
})
