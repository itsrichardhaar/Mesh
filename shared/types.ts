// Cross-process domain types shared between main, preload, and renderer.
// Keep this file Electron-free so the renderer can import it without
// pulling Node-only modules into the browser bundle.

export interface Project {
  /** Claude Code's encoded directory name, e.g. `-Users-richardhaar-Desktop-Mesh`. Primary key. */
  encodedPath: string
  /** The Project's absolute Source Path on disk, e.g. `/Users/richardhaar/Desktop/Mesh`. */
  sourcePath: string
  /** Display name — typically `basename(sourcePath)`, overridable by the user (Slice 4+). */
  name: string
  /** Auto-detected stack subtitle (e.g., `Next.js`, `Rust`). `null` until detection runs or when no canonical files match. */
  autoSubtitle: string | null
  /** ISO 8601 timestamp of the newest event across the Project's Sessions. */
  activity: string
  /** True when the resolved Source Path no longer exists (or isn't a directory) on disk. */
  sourceMissing: boolean
  /** True when the user has flagged this Project as hidden in the sidebar. */
  hidden: boolean
  /**
   * v5 / Slice 43: when true, the idle detector still inserts
   * notifications for this Project (the dropdown surfaces them) but
   * suppresses the `notifications:created` toast event. Matches macOS
   * DND behavior — silencing the toast, not the record.
   */
  muteNotifications: boolean
}

/**
 * Deterministic Stats Row counters. `lastActivityAt` is the precise event
 * timestamp from the newest JSONL line — distinct from `Project.activity`
 * which mirrors the newest JSONL file's mtime for sort purposes.
 */
export interface ProjectStats {
  sessionCount: number
  filesTouchedCount: number
  lastActivityAt: string | null
}

/**
 * Theme preference. `system` follows the OS `prefers-color-scheme` and
 * re-evaluates live; `light` and `dark` are explicit user choices that
 * override the system signal.
 */
export type ThemePreference = 'system' | 'light' | 'dark'

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value)
}

/**
 * UI Mode preference (v2). `sans` keeps Mesh's default Inter-based document
 * feel; `mono` switches the UI font to JetBrains Mono, tightens corner radii,
 * and widens tracking slightly for a CLI / code-editor character. Monaco and
 * xterm stay monospace regardless of this preference.
 */
export type UiModePreference = 'sans' | 'mono'

export const UI_MODE_PREFERENCES: readonly UiModePreference[] = ['sans', 'mono']

export function isUiModePreference(value: unknown): value is UiModePreference {
  return (
    typeof value === 'string' && (UI_MODE_PREFERENCES as readonly string[]).includes(value)
  )
}

/**
 * Identifier for the three Provider slots Mesh ships with. Only `claude`
 * is functional in v1; the others exist so the secrets/settings shape
 * doesn't change when Slice 9 turns them on.
 */
export type ProviderId = 'claude' | 'openai' | 'local'

export const PROVIDER_IDS: readonly ProviderId[] = ['claude', 'openai', 'local']

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value)
}

// --- Analysis shapes ------------------------------------------------------

/**
 * Three-section LLM output Mesh expects back from `ModelClient.analyzeProject`.
 * Slice 10 wires the schema validation; Slice 9 ships the contract so
 * the provider abstraction can compile cleanly.
 */
export interface AnalysisOutput {
  summaryMarkdown: string
  nextSteps: ReadonlyArray<{ text: string }>
  suggestedImprovements: ReadonlyArray<{ text: string }>
}

/**
 * The renderer-facing view of one stored Analysis. Slice 11 writes / reads
 * rows of this shape; failed Analyses carry the same envelope with
 * `status: 'failed'` and the `content` fields nulled out — the renderer
 * decides whether to show the failure (Slice 12).
 */
export interface StoredAnalysis {
  encodedPath: string
  /** ISO 8601 timestamp. Together with `encodedPath`, forms the primary key. */
  generatedAt: string
  status: 'ok' | 'failed'
  errorMessage: string | null
  provider: ProviderId
  model: string
  sourceSessionCount: number | null
  lastAnalyzedSha: string | null
  /** Three-section content, populated only when `status === 'ok'`. */
  content: AnalysisOutput | null
}

export interface AnalyzeProjectInput {
  /** Caller passes whatever context the prompt template needs. */
  systemPrompt: string
  userPrompt: string
}

export interface ValidationResult {
  ok: boolean
  /** Human-readable detail (`401 invalid api key`, `network`, …) when ok=false. */
  message?: string
}

/**
 * Persisted record of the most recent validation attempt for a
 * Provider. Stored as JSON under `model:<provider>:validation` in the
 * `settings` table so Settings → Model can render "last verified Xs
 * ago" on mount without re-spending a token.
 */
export interface StoredValidation {
  /** ISO 8601 timestamp the validation completed. */
  at: string
  ok: boolean
  message?: string
}

/**
 * The provider-agnostic surface every Model-backed client implements.
 * v1 ships `ClaudeClient` as the functional implementation; `OpenAIClient`
 * and `LocalClient` are stubs that throw if invoked. Decision recorded
 * in ADR-0003.
 */
export interface ModelClient {
  readonly provider: ProviderId
  readonly model: string
  validate(): Promise<ValidationResult>
  analyzeProject(input: AnalyzeProjectInput): Promise<AnalysisOutput>
}

/**
 * Patch shape accepted by the `projects.update` IPC. Each key maps to a
 * single column on the `projects` table. Slice 3 exposes `hidden`;
 * Slice 43 (v5) adds `muteNotifications`.
 */
export interface ProjectPatch {
  hidden?: boolean
  muteNotifications?: boolean
}

// --- Notifications (v5 / Slice 41) ----------------------------------------

/**
 * A persistent record of a moment that may need user attention in a
 * Project's Pty Tab. Created by the main-process idle detector when a
 * live Pty Tab transitions from active to idle (no PTY output for ≥ 8 s)
 * while the user is not currently looking at that Pty Tab. Surfaced as
 * a top-right toast on creation (Slice 42) and as a row in the bell-
 * icon dropdown until read or cleared. 7-day retention sweep on app
 * boot keeps the table small.
 */
export interface Notification {
  /** UUID — stable primary key. */
  id: string
  /** ISO 8601 timestamp when the notification was created. */
  createdAt: string
  /** Project this notification belongs to. */
  encodedPath: string
  /** Session this notification belongs to. */
  sessionId: string
  /**
   * The Pty Tab that triggered this notification, when known. May be
   * null on read if the PTY has since exited and the row has outlived
   * its underlying process.
   */
  ptyId: string | null
  /**
   * Discriminator for future notification subtypes. v1 ships only
   * `'idle'`; pattern matchers (v6+) may emit `'approval'`, `'complete'`,
   * `'question'`, etc. Stored as a free-form string in SQLite so adding
   * a value is a code change, not a migration. The renderer treats
   * unknown kinds as `'idle'` (graceful degradation).
   */
  kind: NotificationKind
  /** Human-readable label rendered in the toast + dropdown row. */
  labelText: string
  /** ISO 8601 timestamp when the notification was read; null = unread. */
  readAt: string | null
}

/**
 * String alias for notification subtypes. Open-ended on purpose — future
 * kinds become string literals without a schema migration. The renderer
 * falls back to the `'idle'` label/icon for any kind it doesn't recognize.
 */
export type NotificationKind = 'idle' | (string & { __brand?: 'notification-kind' })

export const KNOWN_NOTIFICATION_KINDS: readonly NotificationKind[] = ['idle']

// --- Quota (v7 / Slice 51) ------------------------------------------------

/**
 * One Claude subscription usage window. `percentUsed` is the window's
 * consumption (0–100) — deliberately never called "utilization" (that
 * word is reserved for the money metric, Subscription Utilization; see
 * CONTEXT.md). The renderer computes the reset countdown against the
 * wall clock from `resetsAt`.
 */
export interface QuotaWindow {
  /** Stable discriminator for which subscription window this is. */
  kind: 'five_hour' | 'seven_day'
  /** Human label, e.g. "5-hour window" / "Weekly window". */
  label: string
  /** Percent of the window consumed (from the endpoint's `utilization`). */
  percentUsed: number
  /** ISO 8601 timestamp when this window's percent-used returns to zero. */
  resetsAt: string
}

/**
 * Account-global Claude Quota, fetched live from Anthropic's OAuth usage
 * endpoint (ADR-0011). Never derived from local logs and never a Usage
 * Event. `null` everywhere the feature is disabled, has no credential,
 * or the fetch failed — the renderer hides its chip in that case.
 */
export interface QuotaSnapshot {
  /** Always `'claude'` in v7 — Mesh is Claude-Code-only (ADR-0002). */
  provider: 'claude'
  windows: ReadonlyArray<QuotaWindow>
  /** ISO 8601 timestamp when this snapshot was fetched. */
  fetchedAt: string
}
