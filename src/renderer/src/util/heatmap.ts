import type { UsageDayPoint } from '@shared/types'

/** The metric an Activity Heatmap shades by — follows the dashboard's Tokens/Cost toggle. */
export type HeatMetric = 'tokens' | 'cost'

/** One day cell in the heatmap grid. */
export interface HeatCell {
  /** `YYYY-MM-DD` (UTC), or `null` for a padding slot past today in the final week. */
  day: string | null
  value: number
  /** Discrete intensity bucket: 0 none, 1 low, 2 med, 3 high — the named legend + lightness/size ramp. */
  level: 0 | 1 | 2 | 3
}

export interface HeatmapGrid {
  /** Columns oldest→newest; each is 7 cells, Monday (0) → Sunday (6). */
  weeks: HeatCell[][]
  /** Largest cell value in the window (0 when empty) — the intensity scale reference. */
  max: number
  /** First/last day of the rendered window, `YYYY-MM-DD` (for the caption). */
  startDay: string
  endDay: string
}

/** Weeks shown — a fixed recent window (PRD-v8: reads as "over time" now, grows into a year later). */
const WEEKS = 26
const DAY_MS = 24 * 60 * 60 * 1000

function utcMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`)
}
function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Bucket a value into 0–3 against the window max. Thirds of max → low/med/high; 0 → none. */
function levelOf(value: number, max: number): 0 | 1 | 2 | 3 {
  if (value <= 0 || max <= 0) return 0
  const ratio = value / max
  if (ratio <= 1 / 3) return 1
  if (ratio <= 2 / 3) return 2
  return 3
}

/**
 * Fold the per-day series into a 26-week calendar grid ending at `now`'s
 * week, shaded by the active metric. Weeks are columns (oldest→newest),
 * weekdays are rows (Monday-aligned, matching the trend's week bucketing).
 * Days past today in the final week are padding (`day: null`). Pure (takes
 * `now`); the heatmap owns this window and ignores the range toggle.
 */
export function heatmapGrid(
  days: readonly UsageDayPoint[],
  metric: HeatMetric,
  now: number
): HeatmapGrid {
  const valueOf = (d: UsageDayPoint): number => (metric === 'tokens' ? d.tokens : d.costUsd)
  const byDay = new Map<string, number>()
  for (const d of days) byDay.set(d.day, valueOf(d))

  const todayMs = utcMs(isoDay(now))
  const dow = new Date(todayMs).getUTCDay() // 0=Sun..6=Sat
  const backToMonday = (dow + 6) % 7
  const currentWeekStart = todayMs - backToMonday * DAY_MS
  const gridStart = currentWeekStart - (WEEKS - 1) * 7 * DAY_MS

  const max = byDay.size === 0 ? 0 : Math.max(0, ...byDay.values())

  const weeks: HeatCell[][] = []
  for (let w = 0; w < WEEKS; w++) {
    const col: HeatCell[] = []
    for (let d = 0; d < 7; d++) {
      const ms = gridStart + (w * 7 + d) * DAY_MS
      if (ms > todayMs) {
        col.push({ day: null, value: 0, level: 0 })
        continue
      }
      const day = isoDay(ms)
      const value = byDay.get(day) ?? 0
      col.push({ day, value, level: levelOf(value, max) })
    }
    weeks.push(col)
  }

  return { weeks, max, startDay: isoDay(gridStart), endDay: isoDay(todayMs) }
}
