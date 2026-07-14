import type { UsageDayPoint } from '@shared/types'
import { heatmapGrid } from '@renderer/util/heatmap'

// 2026-07-15 is a Wednesday; the current week's Monday is 2026-07-13.
const NOW = Date.parse('2026-07-15T00:00:00Z')

function d(day: string, tokens: number, costUsd = 0): UsageDayPoint {
  return { day, tokens, costUsd, inputTokens: 0, outputTokens: tokens, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

const DAYS: UsageDayPoint[] = [
  d('2026-07-15', 100, 9), // today → max
  d('2026-07-13', 50, 3) // Monday of this week → half of max
]

describe('heatmapGrid', () => {
  it('lays out 53 week-columns of 7 weekday cells (a rolling year)', () => {
    const grid = heatmapGrid(DAYS, 'tokens', NOW)
    expect(grid.weeks).toHaveLength(53)
    expect(grid.weeks.every((col) => col.length === 7)).toBe(true)
    expect(grid.weeks.flat()).toHaveLength(371)
    expect(grid.endDay).toBe('2026-07-15')
  })

  it('buckets intensity into none/low/med/high against the window max', () => {
    const grid = heatmapGrid(DAYS, 'tokens', NOW)
    const cell = (day: string): (typeof grid.weeks)[number][number] | undefined =>
      grid.weeks.flat().find((c) => c.day === day)
    expect(grid.max).toBe(100)
    expect(cell('2026-07-15')).toMatchObject({ value: 100, level: 3 }) // 100% → high
    expect(cell('2026-07-13')).toMatchObject({ value: 50, level: 2 }) // 50% → med
    expect(cell('2026-07-14')).toMatchObject({ value: 0, level: 0 }) // no data → none
  })

  it('pads days past today in the final week as empty (day null)', () => {
    const grid = heatmapGrid(DAYS, 'tokens', NOW)
    const padding = grid.weeks.flat().filter((c) => c.day === null)
    // Thu–Sun (16–19) of the current week are still ahead of Wed the 15th.
    expect(padding).toHaveLength(4)
    expect(padding.every((c) => c.level === 0 && c.value === 0)).toBe(true)
  })

  it('shades by the active metric', () => {
    const grid = heatmapGrid(DAYS, 'cost', NOW)
    expect(grid.max).toBe(9)
    expect(grid.weeks.flat().find((c) => c.day === '2026-07-15')).toMatchObject({ value: 9, level: 3 })
  })

  it('reports max 0 for an empty series', () => {
    expect(heatmapGrid([], 'tokens', NOW).max).toBe(0)
  })
})
