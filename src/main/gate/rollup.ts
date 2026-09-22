/**
 * The **run-attribution resolver** for Usage rollup (v11 / ADR-0014, Slice D).
 *
 * Slice B attributes each Worktree Run to its Parent Project (`parentEncodedPath`);
 * this projects that attribution onto the Usage aggregation layer so a Parent's
 * spend reads as one number instead of a dozen ULIDs. It is a pure lookup built
 * from the already-attributed Project list — the `usage_events` cache and its
 * keys stay a faithful mirror (ADR-0009); nothing is re-attributed at ingest.
 *
 * Two directions, mirroring the two query shapes the dashboard needs:
 * - {@link RunAttribution.displayEncodedPath} folds a run's Encoded Path up to
 *   its Parent's — the key the by-Project breakdown groups on.
 * - {@link RunAttribution.membersOf} expands a Parent's Encoded Path to the set
 *   `[parent, ...its runs]` — the predicate a Parent-scoped view filters on.
 */

/** The subset of an attributed Project this resolver reads. */
export interface AttributionEntry {
  encodedPath: string
  /** Parent's Encoded Path / synthetic node id (a run), or `null` (a Project). */
  parentEncodedPath: string | null
}

export interface RunAttribution {
  /**
   * The Encoded Path a given path's Usage rolls up into: a run's
   * `parentEncodedPath`, or the path itself for a Project (or a run whose
   * Parent didn't resolve). Unknown paths pass through unchanged.
   */
  displayEncodedPath(encodedPath: string): string
  /**
   * The Encoded Paths whose Usage belongs to `encodedPath`: the path itself
   * plus every run that rolls up into it. A path with no runs returns just
   * `[encodedPath]`, so callers can always filter on the result.
   */
  membersOf(encodedPath: string): string[]
}

/**
 * Build a {@link RunAttribution} from the attributed Project list. Pure: the
 * same input always yields the same lookups, with no DB or disk access.
 */
export function buildRunAttribution(entries: readonly AttributionEntry[]): RunAttribution {
  const parentOf = new Map<string, string>()
  const childrenOf = new Map<string, string[]>()
  for (const e of entries) {
    if (e.parentEncodedPath === null) continue
    parentOf.set(e.encodedPath, e.parentEncodedPath)
    const siblings = childrenOf.get(e.parentEncodedPath)
    if (siblings) siblings.push(e.encodedPath)
    else childrenOf.set(e.parentEncodedPath, [e.encodedPath])
  }

  return {
    displayEncodedPath: (encodedPath) => parentOf.get(encodedPath) ?? encodedPath,
    membersOf: (encodedPath) => [encodedPath, ...(childrenOf.get(encodedPath) ?? [])]
  }
}
