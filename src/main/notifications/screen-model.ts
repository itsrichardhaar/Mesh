import { Terminal } from '@xterm/headless'

/**
 * Default terminal geometry for the headless screen buffer. Claude
 * Code's approval prompt and ready-input frames fit comfortably inside
 * an 80×40 viewport; the exact size only affects wrapping, not whether
 * a Pattern Matcher's structural anchor is present.
 */
export const DEFAULT_COLS = 80
export const DEFAULT_ROWS = 40

export interface ScreenModelOptions {
  cols?: number
  rows?: number
}

/**
 * Maintains a decoded, ANSI-stripped view of a single Pty Tab's current
 * terminal screen. It wraps a headless xterm buffer so that *all*
 * escape-sequence, cursor-movement, and repaint handling lives behind
 * two methods — `write()` (feed raw PTY output) and `snapshot()` (read
 * the settled visible frame as plain text).
 *
 * This is the deep module of the v9 parse spine: the brittle,
 * format-specific work of turning a live Ink TUI byte-stream into stable
 * text is concentrated here, so the Pattern Matchers that consume
 * `snapshot()` (see ./matchers) can be pure `(screenText) => kind | null`
 * functions with no knowledge of ANSI at all.
 *
 * Ink apps repaint in place (cursor-home + rewrite) rather than using the
 * alternate screen buffer, so the *current* frame is the terminal's
 * visible viewport — `snapshot()` reads exactly that region and excludes
 * scrolled-off history, so stale output above the fold can't false-match.
 */
export class ScreenModel {
  private readonly term: Terminal

  constructor(opts: ScreenModelOptions = {}) {
    this.term = new Terminal({
      cols: opts.cols ?? DEFAULT_COLS,
      rows: opts.rows ?? DEFAULT_ROWS,
      allowProposedApi: true
    })
  }

  /**
   * Feed one raw PTY output chunk. xterm parses writes asynchronously and
   * batches them; the returned promise resolves once this chunk has been
   * parsed, so a subsequent `snapshot()` is guaranteed to reflect it.
   * The real detector (Slice 64) awaits this inside its settle debounce;
   * tests await it before asserting.
   */
  write(bytes: string): Promise<void> {
    return new Promise((resolve) => this.term.write(bytes, resolve))
  }

  /**
   * The current visible frame as ANSI-stripped text: the viewport's rows,
   * each right-trimmed, with leading and trailing blank rows removed and
   * interior blank rows preserved, joined by "\n". This is the settled
   * text a Pattern Matcher runs against.
   */
  snapshot(): string {
    const buf = this.term.buffer.active
    const start = buf.baseY
    const end = start + this.term.rows
    const rows: string[] = []
    for (let i = start; i < end; i++) {
      const line = buf.getLine(i)?.translateToString(true) ?? ''
      rows.push(line.replace(/\s+$/u, ''))
    }
    // Trim leading/trailing blank rows; keep interior structure intact.
    let lo = 0
    let hi = rows.length
    while (lo < hi && rows[lo] === '') lo++
    while (hi > lo && rows[hi - 1] === '') hi--
    return rows.slice(lo, hi).join('\n')
  }

  /** Release the underlying terminal. Call when the Pty Tab exits. */
  dispose(): void {
    this.term.dispose()
  }
}
