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
  /**
   * v11 / ADR-0014: `'worktreeRun'` when this "Project" is actually a git
   * worktree Claude Code ran in (a Worktree Run), rather than a directory the
   * user opened directly. `'project'` otherwise. Derived at discovery time.
   */
  kind: 'project' | 'worktreeRun'
  /**
   * The Worktree Run subtype: `'gate'` for a `no-mistakes` Gate Run,
   * `'plain'` for a generic git worktree. `null` for ordinary Projects.
   */
  subtype: WorktreeRunSubtype | null
  /**
   * The Encoded Path of the Parent Project a Worktree Run belongs to, or a
   * synthetic grouping-node id when the parent can't be resolved. `null` for
   * ordinary Projects. Populated in Slice B (attribution); `null` in Slice A.
   */
  parentEncodedPath: string | null
  /**
   * no-mistakes Gate Run metadata. The `repoId`/`runId` come from path
   * recognition (Slice A); `status`/`prUrl`/`prState`/`branch`/`intent` are
   * enriched from the ring-fenced state read (Slice C) and stay `null` until
   * then. `null` for non-gate Projects.
   */
  gate: GateRunMeta | null
}

/** The two Worktree Run subtypes (v11 / ADR-0014). */
export type WorktreeRunSubtype = 'gate' | 'plain'

/**
 * Prefix for a **synthetic grouping-node** id — the `parentEncodedPath` a
 * Worktree Run gets when its real Parent Project can't be resolved (the state
 * read failed, or the repo has no Claude Code Sessions of its own). It is *not*
 * a fabricated Project (ADR-0002 holds): no Project row carries this id; the
 * sidebar derives a header row from it. Claude Code Encoded Paths always begin
 * with `-`, so this prefix can never collide with a real one.
 */
export const SYNTHETIC_PARENT_PREFIX = 'worktree-group:'

/** Build a synthetic grouping-node id from its display label (repo name or id). */
export function syntheticParentId(label: string): string {
  return SYNTHETIC_PARENT_PREFIX + label
}

/**
 * The display label of a synthetic grouping-node id, or `null` when `id` is a
 * real Encoded Path (i.e. the Parent is a discovered Project).
 */
export function syntheticParentLabel(id: string): string | null {
  return id.startsWith(SYNTHETIC_PARENT_PREFIX) ? id.slice(SYNTHETIC_PARENT_PREFIX.length) : null
}

/**
 * Metadata for a `no-mistakes` Gate Run. `repoId`/`runId` are recognized from
 * the worktree path; the rest is read (best-effort, read-only) from
 * `~/.no-mistakes/state.sqlite` and is `null` when that read is unavailable
 * or hasn't run yet (Slice A carries ids only).
 */
export interface GateRunMeta {
  repoId: string
  runId: string
  /** `'completed'` / `'failed'` from the run's step outcome, or `null`. */
  status: 'completed' | 'failed' | null
  /** The run's pull-request URL, or `null` when it has none. */
  prUrl: string | null
  /** `'merged'` / `'none'` (or another endpoint value), or `null`. */
  prState: string | null
  /** The run's git branch, or `null`. */
  branch: string | null
  /** A human description of what the run was building, or `null`. */
  intent: string | null
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
   * Discriminator for notification subtypes. v5 shipped only `'idle'`;
   * v9 Pattern Matchers emit `'approval'` and `'complete'` (a `'question'`
   * kind remains reserved-but-unimplemented). Stored as a free-form
   * string in SQLite so adding a value is a code change, not a migration.
   * The renderer treats unknown kinds as `'idle'` (graceful degradation).
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

export const KNOWN_NOTIFICATION_KINDS: readonly NotificationKind[] = ['idle', 'approval', 'complete']

/**
 * v9 / Slice 66: the settings key for a Notification Kind's global toast
 * preference. Stored via the generic setting IPC as `'1'` / `'0'`; an
 * absent row means enabled (default all-on, preserving v5 behavior).
 * Shared so main (the toast gate) and the renderer (the toggle UI) agree
 * on the key without coupling across the process boundary.
 */
export function notificationKindToastKey(kind: NotificationKind): string {
  return `notifications_toast_${kind}`
}

// --- Usage (v7 / Slice 52) ------------------------------------------------

/**
 * The atomic record of one assistant turn's token consumption within a
 * Session — the canonical unit every Usage view aggregates from. Derived
 * entirely from the Session's JSONL (never authored) and cached in
 * `usage_events` as a rebuildable index (ADR-0009): dropping the table
 * and re-sweeping the JSONL reproduces it exactly.
 *
 * Attributed to a Project by its containing folder's Encoded Path; the
 * `cwd` field is provenance only, never the attribution key.
 */
export interface UsageEvent {
  /** The assistant message's uuid — stable primary key; dedups re-ingest. */
  eventId: string
  /** Project this turn belongs to (containing folder's Encoded Path). */
  encodedPath: string
  /** Session (JSONL file stem) this turn belongs to. */
  sessionId: string
  /** ISO 8601 timestamp of the turn. */
  timestamp: string
  /** Model that produced the turn, or null when the line doesn't label it. */
  model: string | null
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  /** Claude's `service_tier` (pricing-relevant), or null. */
  serviceTier: string | null
  /** Git branch recorded on the line, or null. Provenance. */
  gitBranch: string | null
  /** Working directory recorded on the line. Provenance only — NOT the attribution key. */
  cwd: string | null
  /** Absolute path of the source JSONL file. Provenance. */
  sourceFile: string
  /** 1-based line number within the source file. Provenance. */
  sourceLine: number
}

/**
 * Coarse ingest status for the Usage cache (v7 / Slice 52). `indexing`
 * while the startup sweep or a Rebuild is running; drives the Home
 * indexing shimmer (Slice 54). `eventCount` is the current row count.
 */
export interface UsageIngestStatus {
  state: 'idle' | 'indexing'
  eventCount: number
}

/**
 * Aggregate Notional Cost across all Usage Events (v7 / Slice 53,
 * ADR-0010). `totalNotionalCostUsd` values usage at published API rates
 * — a measure of intensity, never money spent. `unpricedModels` lists
 * models with no known rate (their tokens are counted, not priced).
 */
export interface CostSummary {
  totalNotionalCostUsd: number
  unpricedModels: string[]
}

/** Headline totals for the global Usage dashboard stat cards (Slice 54). */
export interface UsageSummary {
  eventCount: number
  /** Distinct Sessions that produced at least one Usage Event. */
  sessionCount: number
  /** Distinct Sessions active in the current calendar month (UTC) — session-explorer header. */
  sessionsThisMonth: number
  /** All token classes summed (input + cache-read + cache-write + output). */
  totalTokens: number
  totalNotionalCostUsd: number
  unpricedModels: string[]
}

/** One calendar day's Usage totals — the raw series the trend chart buckets. */
export interface UsageDayPoint {
  /** `YYYY-MM-DD` (UTC). */
  day: string
  tokens: number
  costUsd: number
  /**
   * The day's tokens split by class (Token Composition, v8 / Slice 58) —
   * these four sum to `tokens`. Additive across days, so the renderer can
   * fold them over any range without a separate round-trip.
   */
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** One Project's headline Usage — the Project Screen's Usage strip (Slice 56). */
export interface UsageProjectSummary {
  eventCount: number
  sessionCount: number
  tokens: number
  costUsd: number
}

/** One Project's Usage totals — the by-project breakdown rows (Slice 55). */
export interface UsageProjectRow {
  encodedPath: string
  tokens: number
  costUsd: number
  sessionCount: number
  /** ISO 8601 timestamp of the Project's newest Usage Event. */
  lastActivity: string
}

/** One Model's Usage totals — the by-model breakdown rows (Slice 55 polish). */
export interface UsageModelRow {
  /** Model id, or null when the Usage Event carried no model label. */
  model: string | null
  tokens: number
  costUsd: number
}

/** One Session's Usage totals — the session-explorer rows (Slice 55). */
export interface UsageSessionRow {
  sessionId: string
  encodedPath: string
  tokens: number
  costUsd: number
  eventCount: number
  lastActivity: string
  /** The Session's dominant Model (most tokens), or null when unlabeled. */
  model: string | null
  /** Wall-clock span from the Session's first to last Usage Event, in ms. */
  durationMs: number
}

/** One assistant turn within a Session — the per-turn drill-down (Slice 55). */
export interface UsageTurn {
  eventId: string
  timestamp: string
  model: string | null
  tokens: number
  costUsd: number
}

/**
 * The Usage Filter's Timeframe options (v10 / Slice 69). `all` = no lower
 * bound; the rest are trailing windows ending at "now". `month` is the
 * current calendar month to date.
 */
export type UsageTimeframe = 'all' | 'month' | '7d' | '30d' | '90d'

export function isUsageTimeframe(value: unknown): value is UsageTimeframe {
  return value === 'all' || value === 'month' || value === '7d' || value === '30d' || value === '90d'
}

/**
 * The Usage Filter argument the renderer sends to `usage:get-dashboard`
 * (v10 / ADR-0013). `timeframe` and `encodedPath` (a Project, null = all)
 * re-scope the *filtered* views; the metric toggle and granularity are
 * applied client-side and never re-fetch.
 */
export interface UsageDashboardFilter {
  timeframe: UsageTimeframe
  encodedPath: string | null
}

/**
 * The four global Metric Cards (v10 / Slice 72). Computed in main on the
 * user's **local calendar day** (not UTC) so "today" matches the wall
 * clock, and unaffected by the Usage Filter. Averages are over **active
 * days** (days with any Usage), never calendar days (grill decision #4).
 */
export interface MetricCards {
  /** Local today: total tokens + distinct Sessions active today. */
  today: { tokens: number; sessions: number }
  /** Trailing 7 local days inclusive of today: total tokens + count of active days. */
  sevenDay: { tokens: number; activeDays: number }
  /** Local month-to-date: total tokens, active-day count, and tokens ÷ active days. */
  month: { tokens: number; activeDays: number; avgPerActiveDay: number }
  /**
   * Month-to-date Subscription Utilization (ADR-0010). `null` when no
   * positive plan fee is set (the card shows a set-your-fee hint).
   * `multiple` = notional ÷ fee, surfaced as "N× your plan fee" (never
   * "× value" — CONTEXT.md avoid-list); the bar fills `min(multiple/3, 1)`.
   */
  subscription: { notionalUsd: number; feeUsd: number; multiple: number } | null
}

/**
 * Everything the global Usage dashboard needs in one round-trip (Slice
 * 54); v10 (ADR-0013) makes it filterable. `days`, `byProject`, `byModel`,
 * and `topSessions` are scoped to the active Usage Filter. `summary`,
 * `heatmapDays`, and `metricCards` stay **global** (unaffected by the
 * filter): the headline totals, the rolling-year Activity Heatmap, and the
 * Metric Cards read all-time, all-project.
 */
export interface UsageDashboard {
  summary: UsageSummary
  /** Global Metric Cards — Today / 7-Day / This Month / Subscription (Slice 72). */
  metricCards: MetricCards
  /** Filtered per-day series — the trend chart + Token Composition. */
  days: UsageDayPoint[]
  /** Global per-day series — the Activity Heatmap (ignores the filter). */
  heatmapDays: UsageDayPoint[]
  byProject: UsageProjectRow[]
  byModel: UsageModelRow[]
  /**
   * Sessions matching the filter, most-recent-first, capped at a safety
   * backstop (v10 / Slice 71). `sessionsTotal` is the full filtered count
   * so the UI can show "showing N of M" when the backstop truncates.
   */
  topSessions: UsageSessionRow[]
  sessionsTotal: number
}

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
  /**
   * ISO 8601 timestamp when this window's percent-used returns to zero,
   * or `null` when the window is idle (nothing consumed yet, so no
   * countdown is running — the endpoint returns `resets_at: null`). An
   * idle window still renders (at 0%); it just shows no reset countdown.
   */
  resetsAt: string | null
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
