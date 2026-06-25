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

// --- Transcript entries ---------------------------------------------------

/** A user/assistant text bubble. */
export interface TranscriptMessage {
  kind: 'message'
  /** JSONL line `uuid` (or a stable synthetic id when the line had none). */
  uuid: string
  role: 'user' | 'assistant'
  /** ISO 8601 timestamp from the line, or `null` when absent. */
  timestamp: string | null
  /** Concatenated text content of one message block, rendered via `react-markdown`. */
  markdown: string
}

/**
 * A `tool_use` event surfaced between messages as a `● Tool · key arg`
 * one-liner. `resultSummary` is populated when the matching
 * `tool_result` produced a short, signal-bearing string (Bash output
 * line, "N matches", etc.); `null` when the result was elided as
 * oversized, absent, or unhelpful at this fidelity.
 */
export interface TranscriptToolEvent {
  kind: 'tool'
  /** Tool-use id from the JSONL block (`toolu_…`). Stable React key. */
  uuid: string
  timestamp: string | null
  /** Display name from `tool_use.name` (e.g. `Edit`, `Bash`, `Grep`). */
  tool: string
  /**
   * Most signal-bearing input field, formatted for one-line display:
   *   Edit/Write/Read → `file_path`
   *   Bash            → first line of `command`
   *   Glob/Grep       → `pattern`
   *   anything else   → empty string
   */
  keyArg: string
  /**
   * Short trailer rendered as ` · (summary)` after the key arg. `null`
   * when the result wasn't worth surfacing at this fidelity.
   */
  resultSummary: string | null
}

/**
 * Placeholder for a run of sidechain (`Agent`-tool sub-conversation)
 * events, rendered inline as `↳ sub-agent (N messages)`. Not click-
 * expandable in v1 — the goal is just to make their existence visible.
 */
export interface TranscriptSidechain {
  kind: 'sidechain'
  /** Synthetic id derived from position; for React keys only. */
  id: string
  /** Number of sidechain JSONL events grouped under this indicator. */
  messageCount: number
}

export type TranscriptEntry = TranscriptMessage | TranscriptToolEvent | TranscriptSidechain
