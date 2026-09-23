import type {
  UsageDayPoint,
  UsageModelRow,
  UsageProjectRow,
  UsageSessionRow,
  UsageTurn
} from '@shared/types'
import { notionalCost, type TokenGroup } from './cost'

export type DayGroupRow = TokenGroup & { day: string }

function tokensOf(g: TokenGroup): number {
  return g.inputTokens + g.cacheReadTokens + g.cacheWriteTokens + g.outputTokens
}

/** Fold Notional Cost per value of `key` (e.g. encodedPath / sessionId). */
function costByKey<K extends string>(
  groups: ReadonlyArray<TokenGroup & Record<K, string | null>>,
  key: K
): Map<string, number> {
  const grouped = new Map<string, TokenGroup[]>()
  for (const g of groups) {
    const k = (g[key] as string | null) ?? ''
    const bucket = grouped.get(k)
    if (bucket) bucket.push(g)
    else grouped.set(k, [g])
  }
  const cost = new Map<string, number>()
  for (const [k, gs] of grouped) cost.set(k, notionalCost(gs).totalUsd)
  return cost
}

/** Project-meta shape the by-project breakdown aggregates. */
type ProjectMetaRow = { encodedPath: string; sessionCount: number; tokens: number; lastActivity: string }

/**
 * Fold each row's Encoded Path up to its display (Parent) path, merging a
 * Worktree Run's totals into its Parent's row (v11 / ADR-0014, Slice D):
 * tokens and Sessions summed (Session ids are globally unique across
 * worktrees), `lastActivity` maxed. A Project with no runs is unchanged.
 * The default `resolve` is identity, so callers that don't roll up behave
 * exactly as before. Pure.
 */
export function rollupProjectMeta(
  meta: ReadonlyArray<ProjectMetaRow>,
  resolve: (encodedPath: string) => string = (e) => e
): ProjectMetaRow[] {
  const merged = new Map<string, ProjectMetaRow>()
  for (const m of meta) {
    const key = resolve(m.encodedPath)
    const cur = merged.get(key)
    if (!cur) {
      merged.set(key, { ...m, encodedPath: key })
    } else {
      cur.tokens += m.tokens
      cur.sessionCount += m.sessionCount
      if (m.lastActivity > cur.lastActivity) cur.lastActivity = m.lastActivity
    }
  }
  return [...merged.values()]
}

/**
 * by-project breakdown rows, ranked by tokens descending. `resolve` folds each
 * Worktree Run's Usage into its Parent (v11 / ADR-0014); the default identity
 * leaves every path standing alone. Pure.
 */
export function buildProjectRows(
  costGroups: ReadonlyArray<TokenGroup & { encodedPath: string | null }>,
  meta: ReadonlyArray<ProjectMetaRow>,
  resolve: (encodedPath: string) => string = (e) => e
): UsageProjectRow[] {
  const remapped = costGroups.map((g) => ({
    ...g,
    encodedPath: g.encodedPath === null ? null : resolve(g.encodedPath)
  }))
  const cost = costByKey(remapped, 'encodedPath')
  return rollupProjectMeta(meta, resolve)
    .map((m) => ({
      encodedPath: m.encodedPath,
      tokens: m.tokens,
      costUsd: cost.get(m.encodedPath) ?? 0,
      sessionCount: m.sessionCount,
      lastActivity: m.lastActivity
    }))
    .sort((a, b) => b.tokens - a.tokens)
}

/**
 * by-model breakdown rows, ranked by tokens descending. Reuses the same
 * (model, tier) token groups the cost summary already sums over — cost is
 * priced per model so each row's Notional Cost respects its own tiers. Pure.
 */
export function buildModelRows(groups: readonly TokenGroup[]): UsageModelRow[] {
  const byModel = new Map<string | null, TokenGroup[]>()
  for (const g of groups) {
    const bucket = byModel.get(g.model)
    if (bucket) bucket.push(g)
    else byModel.set(g.model, [g])
  }
  const rows: UsageModelRow[] = []
  for (const [model, gs] of byModel) {
    rows.push({
      model,
      tokens: gs.reduce((sum, g) => sum + tokensOf(g), 0),
      costUsd: notionalCost(gs).totalUsd
    })
  }
  return rows.sort((a, b) => b.tokens - a.tokens)
}

/** Dominant Model (most tokens) per value of `key`. */
function dominantModelByKey<K extends string>(
  groups: ReadonlyArray<TokenGroup & Record<K, string | null>>,
  key: K
): Map<string, string | null> {
  const perKey = new Map<string, Map<string | null, number>>()
  for (const g of groups) {
    const k = (g[key] as string | null) ?? ''
    let models = perKey.get(k)
    if (!models) {
      models = new Map()
      perKey.set(k, models)
    }
    models.set(g.model, (models.get(g.model) ?? 0) + tokensOf(g))
  }
  const out = new Map<string, string | null>()
  for (const [k, models] of perKey) {
    let best: string | null = null
    let bestTokens = -1
    for (const [model, tokens] of models) {
      if (tokens > bestTokens) {
        bestTokens = tokens
        best = model
      }
    }
    out.set(k, best)
  }
  return out
}

/**
 * Session rows most-recent-first (by last activity), with Notional Cost,
 * dominant Model, and duration (v10 / Slice 71). `limit` is a safety
 * backstop, not a top-N — the filter usually bounds the set well under it.
 * Pure.
 */
export function buildSessionRows(
  costGroups: ReadonlyArray<TokenGroup & { sessionId: string | null }>,
  meta: ReadonlyArray<{
    sessionId: string
    encodedPath: string
    eventCount: number
    tokens: number
    firstActivity: string
    lastActivity: string
  }>,
  limit: number
): UsageSessionRow[] {
  const cost = costByKey(costGroups, 'sessionId')
  const model = dominantModelByKey(costGroups, 'sessionId')
  return meta
    .map((m) => {
      const start = Date.parse(m.firstActivity)
      const end = Date.parse(m.lastActivity)
      return {
        sessionId: m.sessionId,
        encodedPath: m.encodedPath,
        tokens: m.tokens,
        costUsd: cost.get(m.sessionId) ?? 0,
        eventCount: m.eventCount,
        startedAt: m.firstActivity,
        lastActivity: m.lastActivity,
        model: model.get(m.sessionId) ?? null,
        durationMs: Number.isNaN(start) || Number.isNaN(end) ? 0 : Math.max(0, end - start)
      }
    })
    .sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : a.lastActivity > b.lastActivity ? -1 : 0))
    .slice(0, limit)
}

/** Per-turn drill-down rows for one Session. Pure. */
export function buildTurns(
  rows: ReadonlyArray<TokenGroup & { eventId: string; timestamp: string }>
): UsageTurn[] {
  return rows.map((r) => ({
    eventId: r.eventId,
    timestamp: r.timestamp,
    model: r.model,
    tokens: tokensOf(r),
    costUsd: notionalCost([r]).totalUsd
  }))
}

/**
 * Collapse per-(day, model, tier) token rows into a per-day series with
 * tokens summed and Notional Cost priced within each day (so each day's
 * cost respects its own model mix + service tiers). The renderer buckets
 * this daily series into day/week/month and filters by range — cost is
 * additive across days, so those roll-ups need no pricing. Pure.
 */
export function buildDayPoints(rows: readonly DayGroupRow[]): UsageDayPoint[] {
  const byDay = new Map<string, TokenGroup[]>()
  for (const row of rows) {
    const groups = byDay.get(row.day)
    if (groups) groups.push(row)
    else byDay.set(row.day, [row])
  }

  const points: UsageDayPoint[] = []
  for (const [day, groups] of byDay) {
    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheWriteTokens = 0
    for (const g of groups) {
      inputTokens += g.inputTokens
      outputTokens += g.outputTokens
      cacheReadTokens += g.cacheReadTokens
      cacheWriteTokens += g.cacheWriteTokens
    }
    const tokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
    points.push({
      day,
      tokens,
      costUsd: notionalCost(groups).totalUsd,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens
    })
  }
  points.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  return points
}
