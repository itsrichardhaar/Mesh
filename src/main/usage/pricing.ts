/**
 * Per-Model API pricing for **Notional Cost** (ADR-0010). Rates are
 * published Anthropic API prices in USD per million tokens — a *snapshot*,
 * not a live feed. Notional Cost is a measure of usage intensity valued
 * at API rates, never money spent (users are on flat-fee subscriptions).
 *
 * Rates drift when Anthropic changes prices; that's acceptable for an
 * intensity gauge and surfaced in-app. Update this table when prices
 * move. Matching is by model *family* (opus / sonnet / haiku) so new
 * point releases (`claude-opus-4-8`, `-4-9`, …) price without edits.
 */

export interface ModelRate {
  /** USD per million fresh input tokens. */
  inputPerMTok: number
  /** USD per million output tokens. */
  outputPerMTok: number
  /** USD per million cache-write (creation) tokens. */
  cacheWritePerMTok: number
  /** USD per million cache-read tokens. */
  cacheReadPerMTok: number
}

/** Family rates. Keyed by the substring matched in the model id. */
const FAMILY_RATES: ReadonlyArray<{ match: string; rate: ModelRate }> = [
  {
    match: 'opus',
    rate: { inputPerMTok: 15, outputPerMTok: 75, cacheWritePerMTok: 18.75, cacheReadPerMTok: 1.5 }
  },
  {
    match: 'sonnet',
    rate: { inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 }
  },
  {
    match: 'haiku',
    rate: { inputPerMTok: 1, outputPerMTok: 5, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1 }
  }
]

/**
 * Service-tier multipliers on the base (standard) rate. Batch is half
 * price; priority is a premium. Unknown/absent tiers price as standard.
 */
const TIER_MULTIPLIER: Record<string, number> = {
  standard: 1,
  standard_only: 1,
  batch: 0.5,
  priority: 1.25
}

export function tierMultiplier(serviceTier: string | null): number {
  if (!serviceTier) return 1
  return TIER_MULTIPLIER[serviceTier] ?? 1
}

/**
 * The rate for a model id, or `null` when the family isn't recognized
 * (an unknown model is counted in tokens but flagged unpriced — never
 * priced by a guess). `null`/empty model → null.
 */
export function rateForModel(model: string | null): ModelRate | null {
  if (!model) return null
  const lower = model.toLowerCase()
  for (const { match, rate } of FAMILY_RATES) {
    if (lower.includes(match)) return rate
  }
  return null
}
