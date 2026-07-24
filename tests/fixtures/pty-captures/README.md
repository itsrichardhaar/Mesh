# Pattern-matcher fixtures (`*.cap`)

Raw Claude Code PTY output byte-streams — ANSI escapes and all — replayed
through `ScreenModel` → `classify()` in `tests/matchers.test.ts`. Each
`.cap` is exactly what `ScreenModel.write()` receives in production, so a
matcher that passes against a real capture is validated against the real
TUI. This is the whole answer to the "TUI parsing is brittle" risk
(ADR-0012): every pattern is one fixture + one assertion.

## Kinds of fixture

- **Positives** — `approval-*.cap`, `complete-*.cap`: frames that must
  classify to `approval` / `complete`.
- **Negatives** — `negative-*.cap`: frames that must classify to `null`
  (an in-progress spinner, a mid-tool question, prompt-ish raw output).
  Negatives guard precision; a matcher that fires on these is worse than
  one that misses, because a false `approval` trains distrust.

## ⚠️ Provenance: synthetic vs recorded

The committed `.cap` files are currently **synthetic** — hand-authored by
`_synthetic.mjs` to model the *structure* of Claude Code's frames (the
numbered permission menu, the ready input prompt, the in-progress
spinner) with real ANSI. They exercise the parse spine end-to-end but are
**not** recordings of a live session. Regenerate them with:

    node _synthetic.mjs

**Record real captures to replace them** (strongly recommended — the
exact glyphs, spacing, and phrasing should come from the real TUI, not
from memory):

    node record.mjs approval-bash      # drive Claude to a Bash permission prompt, Ctrl-] to stop
    node record.mjs complete-ready     # let Claude finish a turn, Ctrl-] to stop

The test loader picks up any `.cap` in this directory automatically; a
real capture with the same name simply replaces its synthetic stand-in.

## Re-record when Claude Code updates its TUI

Matchers anchor on TUI *structure*, so a Claude Code release that reworks
the permission menu or the prompt can make a positive fixture stale. The
architecture self-heals — a matcher that stops recognizing a frame falls
through to the `idle` recall floor (ADR-0012), so notifications still
fire, just less precisely. There is intentionally **no** automated
staleness check. When you notice `approval`/`complete` degrading to
generic `idle` after a Claude Code upgrade, re-record the affected
fixtures with `record.mjs` and adjust the anchors in
`src/main/notifications/matchers.ts`.
