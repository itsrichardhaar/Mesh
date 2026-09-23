import type { Project } from '@shared/types'

/**
 * Gate Run display helpers (ADR-0014), shared so the sidebar row and the
 * Project Screen render the same text and glyph from one source of truth.
 */

/** True when this "Project" is actually a `no-mistakes` Gate Run. */
export function isGateRun(project: Project): boolean {
  return project.kind === 'worktreeRun' && project.subtype === 'gate'
}

/**
 * A Gate Run's human summary — what it built — resolved `intent → branch →
 * short runId`. This is the string the sidebar shows on hover; the Project
 * Screen surfaces it on the page itself. `null` when the project isn't a Gate
 * Run (no `gate` metadata).
 */
export function gateRunSummaryText(project: Project): string | null {
  const gate = project.gate
  if (!gate) return null
  return gate.intent?.trim() || gate.branch?.trim() || gate.runId.slice(0, 8)
}

/** Pass/fail glyph for a Gate Run — shape + text, never hue alone (a11y). */
export interface RunGlyph {
  char: string
  label: string
  className: string
}

export function runStatusGlyph(project: Project): RunGlyph | null {
  if (project.subtype !== 'gate' || !project.gate) return null
  const { status, prState } = project.gate
  if (status === 'completed' || prState === 'merged') {
    return { char: '✓', label: 'passed', className: 'run-glyph-pass' }
  }
  if (status === 'failed') {
    return { char: '✗', label: 'failed', className: 'run-glyph-fail' }
  }
  return null
}
