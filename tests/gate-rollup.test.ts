import { describe, it, expect } from 'vitest'
import { buildRunAttribution, type AttributionEntry } from '@main/gate/rollup'

/**
 * The run-attribution resolver (v11 / ADR-0014, Slice D) projects Slice B's
 * `parentEncodedPath` attribution onto the Usage aggregation layer: fold a run
 * up to its Parent (`displayEncodedPath`) or expand a Parent to its member set
 * (`membersOf`). Pure over the attributed Project list.
 */

const entries: AttributionEntry[] = [
  { encodedPath: '-parent', parentEncodedPath: null }, // a real Project
  { encodedPath: '-run1', parentEncodedPath: '-parent' }, // its gate runs
  { encodedPath: '-run2', parentEncodedPath: '-parent' },
  { encodedPath: '-solo', parentEncodedPath: null }, // a Project with no runs
  { encodedPath: '-orphan', parentEncodedPath: 'worktree-group:moves' } // synthetic parent
]

describe('buildRunAttribution', () => {
  const attr = buildRunAttribution(entries)

  it('folds a run up to its Parent, leaves a Project as itself', () => {
    expect(attr.displayEncodedPath('-run1')).toBe('-parent')
    expect(attr.displayEncodedPath('-run2')).toBe('-parent')
    expect(attr.displayEncodedPath('-parent')).toBe('-parent')
    expect(attr.displayEncodedPath('-solo')).toBe('-solo')
  })

  it('passes an unknown path through unchanged', () => {
    expect(attr.displayEncodedPath('-never-seen')).toBe('-never-seen')
  })

  it('folds an unresolved run up to its synthetic grouping node', () => {
    expect(attr.displayEncodedPath('-orphan')).toBe('worktree-group:moves')
  })

  it('expands a Parent to [parent, ...runs]', () => {
    expect(attr.membersOf('-parent').sort()).toEqual(['-parent', '-run1', '-run2'])
  })

  it('expands a runless Project to just itself', () => {
    expect(attr.membersOf('-solo')).toEqual(['-solo'])
  })

  it('always includes the queried path so callers can filter on the result', () => {
    expect(attr.membersOf('-anything')).toEqual(['-anything'])
  })
})
