import { rateForModel, tierMultiplier, type ModelRate } from './pricing'

/**
 * Token totals for one (model, service_tier) group — the unit the cost
 * aggregation sums over. Grouping by tier as well as model keeps
 * Notional Cost service-tier aware (batch is half price, etc.).
 */
export interface TokenGroup {
  model: string | null
  serviceTier: string | null
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}

export interface NotionalCostResult {
  /** Total Notional Cost in USD (usage valued at API rates — not spend). */
  totalUsd: number
  /**
   * Model ids present in the data that have no known rate — their tokens
   * are counted but contribute $0 to the total, never a guessed price.
   * `null`-labelled models surface as `'unknown'`.
   */
  unpricedModels: string[]
}

/** Cost of one group given its rate and tier multiplier. Pure. */
export function costForGroup(group: TokenGroup, rate: ModelRate, mult: number): number {
  return (
    mult *
    ((group.inputTokens / 1_000_000) * rate.inputPerMTok +
      (group.cacheReadTokens / 1_000_000) * rate.cacheReadPerMTok +
      (group.cacheWriteTokens / 1_000_000) * rate.cacheWritePerMTok +
      (group.outputTokens / 1_000_000) * rate.outputPerMTok)
  )
}

/**
 * Sum Notional Cost across token groups. Unknown-model groups are
 * skipped from the total and reported in `unpricedModels` (ADR-0010:
 * counted, flagged, never guessed).
 */
export function notionalCost(groups: readonly TokenGroup[]): NotionalCostResult {
  let totalUsd = 0
  const unpriced = new Set<string>()
  for (const group of groups) {
    const rate = rateForModel(group.model)
    if (!rate) {
      unpriced.add(group.model ?? 'unknown')
      continue
    }
    totalUsd += costForGroup(group, rate, tierMultiplier(group.serviceTier))
  }
  return { totalUsd, unpricedModels: [...unpriced] }
}
