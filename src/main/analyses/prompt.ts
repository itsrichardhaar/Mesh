import type { TranscriptEntry } from '@shared/sessions'

/**
 * Max characters of prose+tool digest the analyzer keeps per Session.
 * Tight enough that picking 5 Sessions doesn't blow the input window
 * even for verbose Sessions; the Session's `away_summary` (when
 * present and old enough) is preferred over the digest anyway.
 */
const PROSE_DIGEST_MAX_CHARS = 3000

/**
 * Render a transcript into a tight prose + tool-one-liner digest for
 * the analyzer prompt. Drops sidechain summaries entirely at this
 * fidelity, collapses each message to its markdown text, and reduces
 * tool events to a single line. Caps at `PROSE_DIGEST_MAX_CHARS` so
 * one chatty Session can't crowd out the rest of the window.
 */
export function transcriptDigest(entries: ReadonlyArray<TranscriptEntry>): string {
  const lines: string[] = []
  let used = 0
  for (const entry of entries) {
    if (entry.kind === 'sidechain') continue
    let line: string
    if (entry.kind === 'tool') {
      const arg = entry.keyArg ? ` · ${entry.keyArg}` : ''
      const summary = entry.resultSummary ? ` (${entry.resultSummary})` : ''
      line = `[tool] ${entry.tool}${arg}${summary}`
    } else {
      const prefix = entry.role === 'user' ? 'User:' : 'Assistant:'
      const text = entry.markdown.replace(/\s+/g, ' ').trim()
      if (text.length === 0) continue
      line = `${prefix} ${text}`
    }
    // Tight per-line cap so a single huge message can't dominate the
    // window; assistant messages with embedded code routinely cross
    // 1k chars.
    const truncated = line.length > 600 ? line.slice(0, 597) + '…' : line
    if (used + truncated.length + 1 > PROSE_DIGEST_MAX_CHARS) {
      lines.push('…(truncated)')
      break
    }
    lines.push(truncated)
    used += truncated.length + 1
  }
  return lines.join('\n')
}
