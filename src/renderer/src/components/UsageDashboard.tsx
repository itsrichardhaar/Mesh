import { Fragment, useState } from 'react'
import type { Project, UsageProjectRow, UsageSessionRow, UsageTurn } from '@shared/types'
import type { JumpToSessionInput } from './NotificationsBell'
import { useUsage } from '../hooks/useUsage'
import { bucketTrend, type Granularity, type Range, type TrendPoint } from '../util/trend'

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
  const { dashboard, indexing, metric, granularity, range, setMetric, setGranularity, setRange } =
    useUsage()

  if (!dashboard) {
    return (
      <div className="usage-dashboard usage-dashboard-empty">
        <p className="usage-shimmer">{indexing ? 'Indexing your usage…' : 'Loading usage…'}</p>
      </div>
    )
  }

  const { summary, days } = dashboard
  const points = bucketTrend(days, granularity, range, Date.now())

  return (
    <div className="usage-dashboard" aria-label="Usage">
      <div className="usage-toolbar">
        <div className="usage-metric-toggle" role="group" aria-label="Metric">
          <MetricButton label="Tokens" active={metric === 'tokens'} onClick={() => setMetric('tokens')} />
          <MetricButton label="Cost" active={metric === 'cost'} onClick={() => setMetric('cost')} />
        </div>
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
        <label className="usage-range">
          <span className="visually-hidden">Range</span>
          <select
            aria-label="Range"
            value={range}
            onChange={(e) => setRange(e.target.value as Range)}
          >
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">All time</option>
          </select>
        </label>
      </div>

      <div className="usage-stats">
        <StatCard label="Sessions" value={summary.sessionCount.toLocaleString()} />
        <StatCard label="Tokens" value={tokenFmt.format(summary.totalTokens)} />
        <StatCard
          label="Cost"
          value={formatUsd(summary.totalNotionalCostUsd)}
          note="at API rates — not money spent"
        />
      </div>

      <TrendChart points={points} metric={metric} granularity={granularity} indexing={indexing} />

      <ByProjectBreakdown
        rows={dashboard.byProject}
        projects={projects}
        metric={metric}
        onSelectProject={onSelectProject}
      />

      <SessionExplorer
        rows={dashboard.topSessions}
        projects={projects}
        sessionsThisMonth={dashboard.summary.sessionsThisMonth}
        onJumpToSession={onJumpToSession}
      />
    </div>
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
}): JSX.Element | null {
  if (rows.length === 0) return null
  const total = rows.reduce((sum, r) => sum + metricValue(r, metric), 0) || 1
  const max = Math.max(...rows.map((r) => metricValue(r, metric)), 1)

  return (
    <section className="usage-section" aria-label="Usage by project">
      <h3 className="usage-section-title">By project</h3>
      <div className="usage-project-cards">
        {rows.map((row) => {
          const value = metricValue(row, metric)
          const pct = Math.round((value / total) * 100)
          const name = projectName(projects, row.encodedPath)
          return (
            <button
              key={row.encodedPath}
              type="button"
              className="usage-project-card"
              onClick={() => onSelectProject?.(row.encodedPath)}
              aria-label={`${name}: ${formatMetric(value, metric)}, ${pct}% of total, ${row.sessionCount} sessions`}
            >
              <span className="usage-project-card-head">
                <span className="usage-project-name">{name}</span>
                <span className="usage-project-pct">{pct}%</span>
              </span>
              <span className="usage-project-card-value">{formatMetric(value, metric)}</span>
              <span className="usage-project-bar" aria-hidden="true">
                <span className="usage-project-fill" style={{ width: `${(value / max) * 100}%` }} />
              </span>
              <span className="usage-project-card-sub">
                {row.sessionCount} session{row.sessionCount === 1 ? '' : 's'}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
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
  sessionsThisMonth,
  onJumpToSession
}: {
  rows: UsageSessionRow[]
  projects?: Project[]
  sessionsThisMonth: number
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
    <section className="usage-section" aria-label="Top sessions by usage">
      <div className="usage-section-header">
        <h3 className="usage-section-title">Top sessions</h3>
        <span className="usage-section-aside">{sessionsThisMonth} this month</span>
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
  if (points.length === 0) {
    return <p className="usage-trend-empty">{indexing ? 'Indexing…' : 'No usage in this range yet.'}</p>
  }

  const valueOf = (p: TrendPoint): number => (metric === 'tokens' ? p.tokens : p.costUsd)
  const fmtValue = (v: number): string => (metric === 'tokens' ? tokenFmt.format(v) : formatUsd(v))

  const W = 760
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

  const xAt = (i: number): number => (n === 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW)
  const yAt = (v: number): number => yBase - (v / max) * plotH
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
      {labelIdxs.map((i) => (
        <text key={i} className="usage-trend-axis" x={xAt(i)} y={H - 6} textAnchor="middle">
          {formatAxisLabel(points[i]!.label, granularity)}
        </text>
      ))}
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

function StatCard({ label, value, note }: { label: string; value: string; note?: string }): JSX.Element {
  return (
    <div className="usage-stat-card">
      <div className="usage-stat-value">{value}</div>
      <div className="usage-stat-label">{label}</div>
      {note && <div className="usage-stat-note">{note}</div>}
    </div>
  )
}
