import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import type {
  MetricCards as MetricCardsData,
  Project,
  UsageDayPoint,
  UsageModelRow,
  UsageProjectRow,
  UsageSessionRow,
  UsageTimeframe,
  UsageTurn
} from '@shared/types'
import type { JumpToSessionInput } from './NotificationsBell'
import { useUsage } from '../hooks/useUsage'
import {
  bucketTrend,
  tokenComposition,
  type Granularity,
  type TrendPoint
} from '../util/trend'
import { heatmapGrid } from '../util/heatmap'

type TimeView = 'trend' | 'heatmap'

const tokenFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`
}

type Metric = 'tokens' | 'cost'

function metricValue(row: { tokens: number; costUsd: number }, metric: Metric): number {
  return metric === 'tokens' ? row.tokens : row.costUsd
}

function formatMetric(value: number, metric: Metric): string {
  return metric === 'tokens' ? tokenFmt.format(value) : formatUsd(value)
}

interface DashboardProps {
  /** Project list for resolving Encoded Path → display name; from the Home Screen. */
  projects?: Project[]
  /** Click a by-project row → select it on the Home Screen. */
  onSelectProject?: (encodedPath: string) => void
  /** Jump to a Session (v5 three-tier resolution). */
  onJumpToSession?: (input: JumpToSessionInput) => void
}

function projectName(projects: Project[] | undefined, encodedPath: string): string {
  return projects?.find((p) => p.encodedPath === encodedPath)?.name ?? encodedPath
}

/**
 * Global Usage dashboard — the Home Screen's default pane (v7 / Slice
 * 54). Stat cards + a per-metric trend across all Projects. The heavy
 * lifting (ingest, pricing) is main-process; this renders the
 * one-round-trip payload and buckets it client-side by granularity +
 * range. SVG rendering is HITL-verified; logic is unit-tested.
 */
export function UsageDashboard({
  projects,
  onSelectProject,
  onJumpToSession
}: DashboardProps = {}): JSX.Element {
  const {
    dashboard,
    indexing,
    metric,
    granularity,
    timeframe,
    project,
    setMetric,
    setGranularity,
    setTimeframe,
    setProject
  } = useUsage()
  const [timeView, setTimeView] = useState<TimeView>('trend')

  if (!dashboard) {
    return (
      <div className="usage-dashboard usage-dashboard-empty">
        <p className="usage-shimmer">{indexing ? 'Indexing your usage…' : 'Loading usage…'}</p>
      </div>
    )
  }

  const { days, heatmapDays } = dashboard
  const points = bucketTrend(days, granularity)

  return (
    <div className="usage-dashboard" aria-label="Usage">
      <div className="usage-toolbar">
        <div className="usage-metric-toggle" role="group" aria-label="Metric">
          <MetricButton label="Tokens" active={metric === 'tokens'} onClick={() => setMetric('tokens')} />
          <MetricButton label="Cost" active={metric === 'cost'} onClick={() => setMetric('cost')} />
        </div>
        {timeView === 'trend' && (
          <div className="usage-gran-toggle" role="group" aria-label="Granularity">
            {(['day', 'week', 'month'] as Granularity[]).map((g) => (
              <MetricButton
                key={g}
                label={g[0]!.toUpperCase() + g.slice(1)}
                active={granularity === g}
                onClick={() => setGranularity(g)}
              />
            ))}
          </div>
        )}
        <label className="usage-range">
          <span className="visually-hidden">Project</span>
          <select
            aria-label="Project"
            value={project ?? ''}
            onChange={(e) => setProject(e.target.value === '' ? null : e.target.value)}
          >
            <option value="">All projects</option>
            {[...(projects ?? [])]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <option key={p.encodedPath} value={p.encodedPath}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label className="usage-range">
          <span className="visually-hidden">Timeframe</span>
          <select
            aria-label="Timeframe"
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as UsageTimeframe)}
          >
            <option value="all">All time</option>
            <option value="month">This Month</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
          </select>
        </label>
      </div>

      <MetricCardsRow cards={dashboard.metricCards} />

      <div className="usage-time">
        <div className="usage-view-toggle" role="group" aria-label="Time view">
          <MetricButton label="Trend" active={timeView === 'trend'} onClick={() => setTimeView('trend')} />
          <MetricButton label="Heatmap" active={timeView === 'heatmap'} onClick={() => setTimeView('heatmap')} />
        </div>
        {timeView === 'trend' ? (
          <TrendChart points={points} metric={metric} granularity={granularity} indexing={indexing} />
        ) : (
          <ActivityHeatmap days={heatmapDays} metric={metric} />
        )}
      </div>

      <div className="usage-breakdowns">
        <TokenCompositionCard days={dashboard.days} />
        <ByModelBreakdown rows={dashboard.byModel} metric={metric} />
        {/* By-project is redundant when a single Project is selected — the
            whole filtered view already IS that Project (v10 / Slice 70). */}
        {project === null && (
          <ByProjectBreakdown
            rows={dashboard.byProject}
            projects={projects}
            metric={metric}
            onSelectProject={onSelectProject}
          />
        )}
      </div>

      <SessionExplorer
        rows={dashboard.topSessions}
        projects={projects}
        total={dashboard.sessionsTotal}
        onJumpToSession={onJumpToSession}
      />
    </div>
  )
}

/**
 * Ordinal dot/bar palette for the ranked-list cards. Colour is purely
 * decorative — rank is carried by vertical position, bar length, and the
 * value itself — so it never has to be distinguished on its own. Leads
 * with Mesh's accent, then a set that reads on both light and dark themes.
 */
const RANK_COLORS = [
  'var(--accent)',
  '#6c8cff',
  '#8b5cf6',
  '#14b8a6',
  '#ec4899',
  '#f59e0b',
  '#3b82f6',
  '#64748b'
]

interface RankedItem {
  /** Stable React key. */
  key: string
  /** Display label (truncates with ellipsis). */
  name: string
  /** Metric value driving the value text, %, and bar length. */
  value: number
  /** Full-row aria-label (screen-reader summary). */
  ariaLabel: string
  /** When set, the row is a button that fires this on click. */
  onSelect?: () => void
}

/**
 * A single card holding a ranked list of contributors — one row each with
 * an ordinal dot, name, bold value, share-%, and a proportion bar. The
 * layout shared by By model + By project (Slice 55 polish); replaces the
 * former grid of one-card-per-project.
 */
function RankedList({
  title,
  items,
  metric,
  emptyLabel,
  limit
}: {
  title: string
  items: RankedItem[]
  metric: Metric
  emptyLabel: string
  /** When set, render only the first `limit` rows. Shares (%) and bar
   *  scaling stay relative to the full list, so hiding the tail never
   *  inflates the visible rows' percentages. */
  limit?: number
}): JSX.Element {
  const total = items.reduce((sum, i) => sum + i.value, 0) || 1
  const max = Math.max(...items.map((i) => i.value), 1)
  const visible = limit == null ? items : items.slice(0, limit)

  return (
    <section className="usage-ranked" aria-label={title}>
      <h3 className="usage-section-title">{title}</h3>
      {items.length === 0 ? (
        <p className="usage-ranked-empty">{emptyLabel}</p>
      ) : (
        <ul className="usage-ranked-list">
          {visible.map((item, i) => {
            const pct = Math.round((item.value / total) * 100)
            const color = RANK_COLORS[i % RANK_COLORS.length]!
            const body = (
              <>
                <span className="usage-ranked-line">
                  <span className="usage-ranked-dot" style={{ background: color }} aria-hidden="true" />
                  <span className="usage-ranked-name">{item.name}</span>
                  <span className="usage-ranked-value">{formatMetric(item.value, metric)}</span>
                  <span className="usage-ranked-pct">{pct}%</span>
                </span>
                <span className="usage-ranked-bar" aria-hidden="true">
                  <span
                    className="usage-ranked-fill"
                    style={{ width: `${(item.value / max) * 100}%`, background: color }}
                  />
                </span>
              </>
            )
            return (
              <li key={item.key} className="usage-ranked-row">
                {item.onSelect ? (
                  <button
                    type="button"
                    className="usage-ranked-item usage-ranked-item-btn"
                    onClick={item.onSelect}
                    aria-label={item.ariaLabel}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="usage-ranked-item" aria-label={item.ariaLabel}>
                    {body}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/**
 * The four global Metric Cards (v10 / Slice 72) — Today / Last 7 days /
 * This month / Subscription Utilization. Global: computed in main on the
 * user's LOCAL calendar day and unaffected by the Usage Filter (they read
 * `dashboard.metricCards`, not the filtered `days`). Each card leads with a
 * number + label so state never depends on hue (reduced-color-vision); the
 * Subscription card adds a fill bar whose *length* encodes the multiple.
 */
function MetricCardsRow({ cards }: { cards: MetricCardsData }): JSX.Element {
  const { today, sevenDay, month } = cards
  return (
    <div className="usage-metric-cards" aria-label="Usage summary">
      <MetricCard
        label="Today"
        value={tokenFmt.format(today.tokens)}
        sub={`${today.sessions.toLocaleString()} ${today.sessions === 1 ? 'session' : 'sessions'}`}
      />
      <MetricCard
        label="Last 7 days"
        value={tokenFmt.format(sevenDay.tokens)}
        sub={`${sevenDay.activeDays} active ${sevenDay.activeDays === 1 ? 'day' : 'days'}`}
      />
      <MetricCard
        label="This month"
        value={tokenFmt.format(month.tokens)}
        sub={`${tokenFmt.format(month.avgPerActiveDay)} avg / active day`}
      />
      <SubscriptionCard subscription={cards.subscription} />
    </div>
  )
}

function MetricCard({
  label,
  value,
  sub
}: {
  label: string
  value: string
  sub: string
}): JSX.Element {
  return (
    <div className="usage-metric-card">
      <div className="usage-metric-value">{value}</div>
      <div className="usage-metric-label">{label}</div>
      <div className="usage-metric-sub">{sub}</div>
    </div>
  )
}

/**
 * Subscription Utilization card (v8 / Slice 60 → v10 / Slice 72) — this
 * month's Notional Cost as a multiple of the user's flat plan fee, read as
 * "N× your plan fee" (never "× value" — CONTEXT.md avoid-list). Framed
 * value-vs-fee, not spend (ADR-0010): the fee is a constant, never
 * decremented per use. The bar fills `min(multiple/3, 1)` so 3×+ is full.
 * `subscription === null` (no positive fee) shows a set-your-fee hint.
 */
function SubscriptionCard({
  subscription
}: {
  subscription: MetricCardsData['subscription']
}): JSX.Element {
  if (!subscription) {
    return (
      <section
        className="usage-metric-card usage-metric-card-sub"
        aria-label="Subscription Utilization"
      >
        <div className="usage-metric-value usage-metric-value-muted" aria-hidden="true">
          —
        </div>
        <div className="usage-metric-label">Subscription</div>
        <p className="usage-metric-sub">
          Set your monthly plan fee in Settings to see whether your subscription is paying off.
        </p>
      </section>
    )
  }

  const { notionalUsd, feeUsd, multiple } = subscription
  const fill = Math.min(multiple / 3, 1) // 3×+ = full (grill decision #5)
  const multipleText = `${multiple.toFixed(1)}×`
  return (
    <section
      className="usage-metric-card usage-metric-card-sub"
      aria-label={`Subscription Utilization: ${multipleText} your plan fee — ${formatUsd(notionalUsd)} of Notional Cost this month against your ${formatUsd(feeUsd)} plan fee, at API rates not money spent`}
    >
      <div className="usage-metric-value" aria-hidden="true">
        {multipleText}
      </div>
      <div className="usage-metric-label">your plan fee</div>
      <span className="usage-metric-bar" aria-hidden="true">
        <span className="usage-metric-fill" style={{ width: `${fill * 100}%` }} />
      </span>
      <div className="usage-metric-sub" aria-hidden="true">
        {formatUsd(notionalUsd)} vs {formatUsd(feeUsd)} · at API rates, not money spent
      </div>
    </section>
  )
}

/**
 * The four token classes in a fixed order with stable colours — order
 * and colour are consistent across renders so a class is recognised by
 * position, not just hue (the reduced-color-vision constraint). Always a
 * token share; never priced.
 */
const COMPOSITION_CLASSES = [
  { key: 'inputTokens', label: 'Input', color: '#6c8cff' },
  { key: 'outputTokens', label: 'Output', color: '#14b8a6' },
  { key: 'cacheReadTokens', label: 'Cache read', color: 'var(--accent)' },
  { key: 'cacheWriteTokens', label: 'Cache write', color: '#8b5cf6' }
] as const

/**
 * Token Composition (v8 / Slice 58) — the share of tokens across the four
 * classes over the active Usage Filter, as a stacked proportion bar +
 * labeled rows. The day series is already filter-scoped in main (v10), so
 * this folds all of it; always a token share regardless of the metric toggle.
 */
function TokenCompositionCard({ days }: { days: UsageDayPoint[] }): JSX.Element {
  const comp = tokenComposition(days)
  const rows = COMPOSITION_CLASSES.map((c) => {
    const value = comp[c.key]
    return { ...c, value, pct: comp.total === 0 ? 0 : Math.round((value / comp.total) * 100) }
  })

  return (
    <section className="usage-ranked" aria-label="Token composition">
      <h3 className="usage-section-title">Token composition</h3>
      {comp.total === 0 ? (
        <p className="usage-ranked-empty">No token usage in this range yet.</p>
      ) : (
        <>
          <div className="usage-composition-bar" aria-hidden="true">
            {rows.map((r) =>
              r.value === 0 ? null : (
                <span
                  key={r.key}
                  className="usage-composition-seg"
                  style={{ width: `${(r.value / comp.total) * 100}%`, background: r.color }}
                />
              )
            )}
          </div>
          <ul className="usage-ranked-list">
            {rows.map((r) => (
              <li key={r.key} className="usage-ranked-row">
                <div
                  className="usage-ranked-item"
                  aria-label={`${r.label}: ${tokenFmt.format(r.value)} tokens, ${r.pct}%`}
                >
                  <span className="usage-ranked-line">
                    <span className="usage-ranked-dot" style={{ background: r.color }} aria-hidden="true" />
                    <span className="usage-ranked-name">{r.label}</span>
                    <span className="usage-ranked-value">{tokenFmt.format(r.value)}</span>
                    <span className="usage-ranked-pct">{r.pct}%</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function ByProjectBreakdown({
  rows,
  projects,
  metric,
  onSelectProject
}: {
  rows: UsageProjectRow[]
  projects?: Project[]
  metric: Metric
  onSelectProject?: (encodedPath: string) => void
}): JSX.Element {
  const items: RankedItem[] = rows
    .map((row) => {
      const value = metricValue(row, metric)
      const name = projectName(projects, row.encodedPath)
      const sessions = `${row.sessionCount} session${row.sessionCount === 1 ? '' : 's'}`
      return {
        key: row.encodedPath,
        name,
        value,
        ariaLabel: `${name}: ${formatMetric(value, metric)}, ${sessions}`,
        onSelect: () => onSelectProject?.(row.encodedPath)
      }
    })
    // Rows arrive sorted by tokens; re-sort by the active metric so the
    // top 5 is the top 5 of what's actually shown (matters under Cost).
    .sort((a, b) => b.value - a.value)
  return (
    <RankedList
      title="By project"
      items={items}
      metric={metric}
      emptyLabel="No project usage yet."
      limit={5}
    />
  )
}

function ByModelBreakdown({
  rows,
  metric
}: {
  rows: UsageModelRow[]
  metric: Metric
}): JSX.Element {
  const items: RankedItem[] = rows.map((row) => {
    const value = metricValue(row, metric)
    const name = row.model ?? 'unknown'
    return {
      key: name,
      name,
      value,
      ariaLabel: `${name}: ${formatMetric(value, metric)}`
    }
  })
  return <RankedList title="By model" items={items} metric={metric} emptyLabel="No model usage yet." />
}

/** Human duration for a Session span, e.g. `41s`, `22m`, `21h 42m`. Hours are not rolled into days. */
function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function SessionExplorer({
  rows,
  projects,
  total,
  onJumpToSession
}: {
  rows: UsageSessionRow[]
  projects?: Project[]
  /** Full count of filtered sessions (rows may be capped at the backstop). */
  total: number
  onJumpToSession?: (input: JumpToSessionInput) => void
}): JSX.Element | null {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [turns, setTurns] = useState<Record<string, UsageTurn[]>>({})

  if (rows.length === 0) return null

  const toggle = async (sessionId: string): Promise<void> => {
    if (expanded === sessionId) {
      setExpanded(null)
      return
    }
    setExpanded(sessionId)
    if (!turns[sessionId]) {
      const detail = await window.api.usage.getSessionEvents(sessionId)
      setTurns((prev) => ({ ...prev, [sessionId]: detail }))
    }
  }

  return (
    <section className="usage-section" aria-label="Recent sessions">
      <div className="usage-section-header">
        <h3 className="usage-section-title">Recent sessions</h3>
        <span className="usage-section-aside">
          {rows.length < total
            ? `Showing ${rows.length} of ${total.toLocaleString()}`
            : `${total.toLocaleString()} ${total === 1 ? 'session' : 'sessions'}`}
        </span>
      </div>
      <div className="usage-table-wrap">
        <table className="usage-session-table">
          <thead>
            <tr>
              <th scope="col">Session</th>
              <th scope="col">Project</th>
              <th scope="col">Model</th>
              <th scope="col" className="num">Tokens</th>
              <th scope="col" className="num">Notional</th>
              <th scope="col" className="num">Duration</th>
              <th scope="col"><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const name = projectName(projects, row.encodedPath)
              const isOpen = expanded === row.sessionId
              return (
                <Fragment key={row.sessionId}>
                  <tr>
                    <td>
                      <button
                        type="button"
                        className="usage-session-id-btn"
                        aria-expanded={isOpen}
                        onClick={() => void toggle(row.sessionId)}
                      >
                        {row.sessionId.slice(0, 8)}
                      </button>
                    </td>
                    <td>{name}</td>
                    <td className="usage-session-model">{row.model ?? 'unknown'}</td>
                    <td className="num">{tokenFmt.format(row.tokens)}</td>
                    <td className="num">{formatUsd(row.costUsd)}</td>
                    <td className="num">{formatDuration(row.durationMs)}</td>
                    <td className="num">
                      <button
                        type="button"
                        className="usage-session-jump"
                        onClick={() =>
                          onJumpToSession?.({
                            encodedPath: row.encodedPath,
                            sessionId: row.sessionId,
                            ptyId: null
                          })
                        }
                      >
                        Jump
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="usage-turn-detail-row">
                      <td colSpan={7}>
                        <ul className="usage-turn-list">
                          {(turns[row.sessionId] ?? []).map((turn) => (
                            <li key={turn.eventId} className="usage-turn-row">
                              <span className="usage-turn-model">{turn.model ?? 'unknown'}</span>
                              <span className="usage-turn-meta">
                                {tokenFmt.format(turn.tokens)} tokens · {formatUsd(turn.costUsd)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

const HEAT_LEGEND = [
  { level: 0, label: 'None' },
  { level: 1, label: 'Low' },
  { level: 2, label: 'Med' },
  { level: 3, label: 'High' }
] as const

/**
 * Activity Heatmap (v8 / Slice 59) — a ~1-year calendar shaded by the
 * active metric. The other view mode of the shared time slot. Intensity
 * is encoded three redundant ways so it never depends on hue (the
 * reduced-color-vision constraint): a lightness ramp *and* the cell's
 * fill size (both driven by `data-level` in CSS) *and* the exact value on
 * hover. A discrete named legend spells out the buckets.
 */
function ActivityHeatmap({ days, metric }: { days: UsageDayPoint[]; metric: Metric }): JSX.Element {
  const grid = heatmapGrid(days, metric, Date.now())
  const fmt = (v: number): string => (metric === 'tokens' ? tokenFmt.format(v) : formatUsd(v))

  if (grid.max === 0) {
    return <p className="usage-trend-empty">No usage in the last year yet.</p>
  }

  return (
    <div className="usage-heatmap">
      <div
        className="usage-heatmap-grid"
        role="img"
        aria-label={`Activity heatmap by ${metric}, last year`}
      >
        {grid.weeks.map((col, wi) => (
          <div key={wi} className="usage-heatmap-col">
            {col.map((cell, di) => (
              <span
                key={di}
                className="usage-heatmap-cell"
                data-level={cell.day === null ? undefined : cell.level}
                data-empty={cell.day === null ? '' : undefined}
                title={cell.day === null ? undefined : `${cell.day}: ${fmt(cell.value)}`}
              >
                <span className="usage-heatmap-fill" />
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="usage-heatmap-footer">
        <span className="usage-heatmap-caption">
          {grid.startDay} – {grid.endDay}
        </span>
        <div className="usage-heatmap-legend">
          {HEAT_LEGEND.map((l) => (
            <span key={l.level} className="usage-heatmap-legend-item">
              <span className="usage-heatmap-cell" data-level={l.level}>
                <span className="usage-heatmap-fill" />
              </span>
              {l.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Format a bucket label for the x-axis, e.g. `2026-07-13`→`Jul 13`, `2026-07`→`Jul 2026`. */
function formatAxisLabel(label: string, granularity: Granularity): string {
  const [year, month, day] = label.split('-')
  const monthName = MONTHS[Number(month) - 1] ?? ''
  return granularity === 'month' ? `${monthName} ${year}` : `${monthName} ${Number(day)}`
}

/** A smooth (Catmull-Rom → cubic Bézier) path through the points. */
function smoothPath(pts: ReadonlyArray<{ x: number; y: number }>): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0]!.x} ${pts[0]!.y}`
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const p3 = pts[i + 2] ?? p2
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d
}

/**
 * Track an element's rendered pixel width via ResizeObserver, falling
 * back to `fallback` until measured (or where ResizeObserver / layout are
 * unavailable, e.g. jsdom). Lets an SVG render at a 1:1 user-unit-to-pixel
 * scale so its text and height stay fixed while it fills a fluid width —
 * instead of the whole viewBox scaling up with the window.
 */
function useMeasuredWidth<T extends Element>(fallback: number): [React.RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => {
      const w = el.clientWidth
      if (w > 0) setWidth(w)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

function TrendChart({
  points,
  metric,
  granularity,
  indexing
}: {
  points: TrendPoint[]
  metric: 'tokens' | 'cost'
  granularity: Granularity
  indexing: boolean
}): JSX.Element {
  // Render at the container's real pixel width so 1 user unit = 1px: axis
  // text stays 11px and the chart stays `H` tall on any window size,
  // rather than the viewBox scaling uniformly and ballooning both.
  const [svgRef, W] = useMeasuredWidth<SVGSVGElement>(760)

  if (points.length === 0) {
    return <p className="usage-trend-empty">{indexing ? 'Indexing…' : 'No usage in this range yet.'}</p>
  }

  const valueOf = (p: TrendPoint): number => (metric === 'tokens' ? p.tokens : p.costUsd)
  const fmtValue = (v: number): string => (metric === 'tokens' ? tokenFmt.format(v) : formatUsd(v))

  const H = 220
  const padL = 54
  const padR = 14
  const padT = 12
  const padB = 22
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const yBase = padT + plotH
  const n = points.length
  const max = Math.max(...points.map(valueOf), 1)
  // Headroom above the data max so a sharp peak's smoothing overshoot
  // stays inside the viewBox instead of being clipped at the top edge.
  const domainMax = max * 1.12

  const xAt = (i: number): number => (n === 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW)
  const yAt = (v: number): number => yBase - (v / domainMax) * plotH
  const coords = points.map((p, i) => ({ x: xAt(i), y: yAt(valueOf(p)) }))
  const line = smoothPath(coords)
  const area =
    coords.length > 1
      ? `${line} L ${coords[n - 1]!.x.toFixed(2)} ${yBase} L ${coords[0]!.x.toFixed(2)} ${yBase} Z`
      : ''
  const last = coords[n - 1]!

  const TICKS = 3
  const yTicks = Array.from({ length: TICKS + 1 }, (_, k) => (max * k) / TICKS)
  const maxLabels = Math.min(n, 6)
  const labelIdxs =
    n === 1 ? [0] : Array.from({ length: maxLabels }, (_, k) => Math.round((k * (n - 1)) / (maxLabels - 1)))

  return (
    <svg
      className="usage-trend"
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Usage trend by ${metric}`}
      data-points={n}
    >
      <defs>
        <linearGradient id="usage-trend-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--accent)', stopOpacity: 0.22 }} />
          <stop offset="100%" style={{ stopColor: 'var(--accent)', stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {yTicks.map((t, k) => {
        const y = yAt(t)
        return (
          <g key={k}>
            <line className="usage-trend-grid" x1={padL} y1={y} x2={W - padR} y2={y} />
            <text className="usage-trend-axis" x={padL - 8} y={y + 3} textAnchor="end">
              {fmtValue(t)}
            </text>
          </g>
        )
      })}
      {area && <path className="usage-trend-area" d={area} fill="url(#usage-trend-grad)" />}
      <path className="usage-trend-line" d={line} />
      <circle className="usage-trend-dot" cx={last.x} cy={last.y} r={3.5} />
      {labelIdxs.map((i, k) => {
        // Anchor the endpoints inward (start/end) so the first and last
        // labels sit inside the plot bounds instead of overflowing the
        // viewBox and being clipped at the edges.
        const isFirst = k === 0
        const isLast = k === labelIdxs.length - 1
        const anchor = isFirst ? 'start' : isLast ? 'end' : 'middle'
        const x = isFirst ? padL : isLast ? W - padR : xAt(i)
        return (
          <text key={i} className="usage-trend-axis" x={x} y={H - 6} textAnchor={anchor}>
            {formatAxisLabel(points[i]!.label, granularity)}
          </text>
        )
      })}
    </svg>
  )
}

function MetricButton({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={`usage-toggle-btn${active ? ' usage-toggle-btn-active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

