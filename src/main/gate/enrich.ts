/**
 * Enriches each **Gate Run** with the metadata `no-mistakes` recorded for it
 * (ADR-0014, Slice C): status, PR url/state, branch, and the run's intent. The
 * ids came from path recognition (Slice A); this folds in the `runs`-table read
 * so a nested row can show pass/fail, what it built, and where its PR went.
 *
 * Pure over its inputs — the attributed list plus the `runId → enrichment` map
 * — so it tests against in-memory data with no DB. Best-effort: a run with no
 * matching row (or an empty map, when the ring-fenced read failed) is returned
 * untouched, still carrying its recognized ids.
 */
import type { GateRunEnrichment } from './no-mistakes-state'
import type { AttributedProject } from './attribute'

export function enrichGateRuns(
  projects: AttributedProject[],
  runMeta: Map<string, GateRunEnrichment>
): AttributedProject[] {
  return projects.map((p) => {
    if (p.kind !== 'worktreeRun' || p.subtype !== 'gate' || !p.gate) return p
    const meta = runMeta.get(p.gate.runId)
    if (!meta) return p
    return { ...p, gate: { ...p.gate, ...meta } }
  })
}
