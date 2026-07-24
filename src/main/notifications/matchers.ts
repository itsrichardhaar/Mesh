import type { NotificationKind } from '@shared/types'

/**
 * A Pattern Matcher recognizes a Notification Kind from the settled,
 * ANSI-stripped terminal screen (see ScreenModel.snapshot). It is a pure
 * predicate — no I/O, no state — so it is unit-tested simply by replaying
 * a recorded byte-stream fixture through a ScreenModel and asserting the
 * kind. Returns its kind when the screen structurally matches, else null.
 *
 * Anchors are deliberately STRUCTURAL, not prose: they key off the shape
 * Claude Code renders (a numbered-option selection menu; the ready input
 * prompt) rather than any single sentence, so a copy tweak in a future
 * Claude Code release degrades precision (fall through to the `idle`
 * recall floor in the detector) instead of silently mis-firing.
 */
export type Matcher = (screen: string) => NotificationKind | null

/**
 * `approval` — Claude is blocked on a tool-permission prompt and needs
 * the user to answer now. Anchor: the numbered-option selection menu
 * (a `❯` selector on a numbered line) together with one of Claude
 * Code's stable permission-prompt phrases. Requiring both the selector
 * *and* a prompt phrase avoids matching an arbitrary numbered list in
 * ordinary output.
 */
export const matchApproval: Matcher = (screen) => {
  const hasSelector = /❯\s*\d+\.\s/u.test(screen)
  const hasProceedPhrase =
    /Do you want to proceed\?/u.test(screen) ||
    /No, and tell Claude what to do differently/u.test(screen)
  return hasSelector && hasProceedPhrase ? 'approval' : null
}

/**
 * `complete` — Claude finished its turn and returned to the empty input
 * prompt. Anchor: the ready-prompt affordance is present AND the
 * in-progress "interrupt" hint is absent. The absence check is what
 * distinguishes a genuinely-finished turn from one still running (which
 * shows an interrupt hint while the spinner animates).
 */
export const matchComplete: Matcher = (screen) => {
  const atReadyPrompt =
    /\bfor shortcuts\b/u.test(screen) || /(?:^|\n)\s*>\s*$/u.test(screen)
  const working = /esc to interrupt/iu.test(screen)
  return atReadyPrompt && !working ? 'complete' : null
}

/**
 * Ordered by precedence: `approval` outranks `complete`. On a settled
 * frame the two are naturally mutually exclusive (a permission menu is
 * not the empty input prompt), so the order is a defensive tie-break
 * rather than a routine one.
 */
export const MATCHERS: readonly Matcher[] = [matchApproval, matchComplete]

/**
 * Run every matcher in precedence order and return the first kind that
 * fires, or null when the screen matches nothing more specific than the
 * generic `idle` recall floor. The detector (Slice 64) treats a null
 * here as "let the idle timer decide."
 */
export function classify(screen: string): NotificationKind | null {
  for (const matcher of MATCHERS) {
    const kind = matcher(screen)
    if (kind !== null) return kind
  }
  return null
}
