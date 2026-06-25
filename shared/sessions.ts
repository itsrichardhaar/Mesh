// Cross-process shapes for the Sessions list and transcript renderer.
// Renderer-importable — must stay Electron-free.

/**
 * One card in the Workspace Screen's Sessions column. Computed from
 * a single `<uuid>.jsonl` file in `~/.claude/projects/<encoded>/`.
 */
export interface SessionSummary {
  /** The `<uuid>` portion of the JSONL filename. */
  sessionId: string
  /**
   * Up to ~60 characters drawn from the Session's first user message,
   * with newlines collapsed. Empty when no user message is present yet.
   */
  title: string
  /**
   * Up to ~3 lines of the Session's first user message, preserving
   * newlines. Empty when no user message is present yet.
   */
  preview: string
  /**
   * ISO 8601 timestamp of the newest line in the JSONL. Drives sort
   * order and the relative-time label on each card. `null` only when
   * no line carries a timestamp.
   */
  lastActivityAt: string | null
}

/**
 * One transcript row in the Workspace Screen's right pane. Only
 * user/assistant text blocks survive into v1 of the renderer; tool
 * calls, tool results, and sidechains land in Slice 15.
 */
export interface TranscriptMessage {
  /** JSONL line `uuid`. Used as the React key. */
  uuid: string
  role: 'user' | 'assistant'
  /** ISO 8601 timestamp from the line, or `null` when absent. */
  timestamp: string | null
  /** Concatenated text content, rendered via `react-markdown`. */
  markdown: string
}
