// IPC contract surface exposed to the renderer via the preload bridge.
// Every method here corresponds to a registered `ipcMain.handle` in src/main.

import type { FileReadResponse, FilesTreeRequest, FilesTreeResponse } from './files'
import type {
  PtyCreateRequest,
  PtyCreateResponse,
  PtyDataEvent,
  PtyExitEvent
} from './pty'
import type { SessionSummary, TranscriptEntry } from './sessions'
import type {
  CostSummary,
  Notification,
  Project,
  ProjectPatch,
  ProjectStats,
  ProviderId,
  QuotaSnapshot,
  StoredAnalysis,
  StoredValidation,
  ThemePreference,
  UsageDashboard,
  UsageDashboardFilter,
  UsageIngestStatus,
  UsageProjectSummary,
  UsageTurn,
  ValidationResult
} from './types'

export interface MeshApi {
  /** Round-trip ping for verifying the IPC bridge is working. */
  ping(): Promise<string>

  projects: {
    /** Enumerate every Project from `~/.claude/projects/`, sorted by Activity descending. */
    list(): Promise<Project[]>

    /** Apply a typed patch to a Project's augmentation columns (hidden, etc.). */
    update(encodedPath: string, patch: ProjectPatch): Promise<void>

    /** Compute the Stats Row counters for one Project on demand. */
    stats(encodedPath: string): Promise<ProjectStats>
  }

  /**
   * Application-menu signals. Main fires these when the user triggers a
   * menu item (or its accelerator); the renderer decides what to do with
   * each based on the active screen. Each subscribe returns an unsubscribe.
   */
  menu: {
    onOpenSettings(cb: () => void): () => void
    onCloseRequested(cb: () => void): () => void
    onBack(cb: () => void): () => void
    onToggleHidden(cb: () => void): () => void
  }

  window: {
    /** Ask main to close the BrowserWindow — main intercepts to hide on macOS. */
    close(): void
  }

  /**
   * Persistent key/value store backed by the SQLite `settings` table.
   * Strings only here — encrypted secrets (Slice 7) use a separate API.
   */
  settings: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>

    /**
     * Read the currently Active Provider. Defaults to `'claude'` when
     * no `active_provider` row has been written — backward-compatible
     * with v0.3.x installs. v4 Slice 36.
     */
    getActiveProvider(): Promise<ProviderId>

    /**
     * Persist the user's Active Provider choice. Validates the value
     * at the boundary; out-of-shape values reject. Fires
     * `onActiveProviderChanged` on all live subscribers. v4 Slice 36.
     */
    setActiveProvider(provider: ProviderId): Promise<void>

    /**
     * Live notification of Active Provider changes. The renderer's
     * Settings panel and Analyze button subtitle subscribe so the UI
     * updates without polling. Returns an unsubscribe. v4 Slice 36.
     */
    onActiveProviderChanged(cb: (provider: ProviderId) => void): () => void

    /**
     * Live notification of per-Provider Model selection changes — fires
     * when any `model:{provider}` key is written. The Analyze button
     * subtitle subscribes so picking a different Model in Settings
     * updates the subtitle without page refresh. v4 Slice 36.
     */
    onModelChanged(cb: (key: string) => void): () => void
  }

  /**
   * Native-theme integration. Setting the source updates Electron's
   * `nativeTheme.themeSource`, which controls macOS chrome (title bar,
   * vibrancy, native dialogs) in lock-step with the in-app palette.
   */
  theme: {
    setSource(source: ThemePreference): void
  }

  /**
   * Provider API keys, encrypted via Electron's `safeStorage` and
   * persisted as bytes in `settings.value_blob`. The renderer never
   * sees plaintext — `getMask` returns the display form
   * (`sk-ant-…••••XXXX`) or `null` when nothing is stored.
   */
  secrets: {
    /** True when the OS keychain is available (macOS Keychain, etc.). */
    available(): Promise<boolean>
    set(provider: ProviderId, plaintext: string): Promise<void>
    getMask(provider: ProviderId): Promise<string | null>
    clear(provider: ProviderId): Promise<void>
    /**
     * 1-token probe against the stored key for `provider`. Returns
     * `{ ok }` when the call succeeds and `{ ok: false, message }`
     * with a human-readable reason on failure. Always persists the
     * outcome to the `settings` table so future mounts can render the
     * "last verified Xs ago" tag without re-spending a token.
     */
    validate(provider: ProviderId): Promise<ValidationResult>
    /**
     * Last persisted validation record for `provider`, or `null` if
     * the key has never been validated. Used by Settings → Model on
     * mount to show the prior status without re-spending a token.
     */
    getLastValidation(provider: ProviderId): Promise<StoredValidation | null>
  }

  /**
   * Native shell handoff. `openExternal` defers to the user's default
   * browser via `shell.openExternal`; in-app webviews are intentionally
   * not used so signing-in flows and link previews land in the
   * platform's own browser.
   */
  shell: {
    openExternal(url: string): Promise<void>
  }

  /**
   * Persistent history of LLM-generated Analyses. Slice 10's
   * orchestrator writes rows; the renderer reads `latest` on Project
   * selection so existing Analyses render without requiring a fresh
   * Analyze click.
   */
  analyses: {
    latest(encodedPath: string): Promise<StoredAnalysis | null>
    /**
     * Build the prompt, call the active Provider's Model, validate the
     * three-section schema, and persist the row. Rejects when no key
     * is saved, the chosen Provider isn't available, or the LLM
     * response fails schema validation — error UX is Slice 12's
     * concern. Returns the freshly-stored Analysis on success.
     */
    run(encodedPath: string): Promise<StoredAnalysis>
  }

  /**
   * Live, gitignore-aware file tree rooted at a Project's Source Path.
   * `tree` returns immediate children of `request.relPath` (default
   * root). `onTreeChanged` fires whenever chokidar reports any
   * filesystem activity inside the watched Project — the renderer
   * re-queries `tree` for whatever it has expanded.
   */
  files: {
    tree(encodedPath: string, request?: FilesTreeRequest): Promise<FilesTreeResponse>
    onTreeChanged(cb: (encodedPath: string) => void): () => void
    /**
     * Read a file relative to the Project's Source Path. Rejects with
     * a `FileReadError`-shaped object (carrying a `code` field) when
     * the file is too large, missing, not a regular file, or escapes
     * the root. The 5 MB cap is enforced in main and surfaces as a
     * `too-large` code — the renderer renders an "open externally"
     * banner rather than the editor.
     */
    read(encodedPath: string, relPath: string): Promise<FileReadResponse>
  }

  /**
   * Live `claude --resume <sessionId>` pty layer. `create` spawns the
   * process (cwd = the Project's Source Path); `write` / `resize` /
   * `kill` operate on a given `ptyId`. Streaming events arrive via
   * `onData` (every output chunk) and `onExit` (once, when the child
   * exits). v1 ships single-pty-per-window semantics; the surface is
   * already keyed by `ptyId` so Slice 17 can add multi-tab without
   * changing this contract.
   */
  pty: {
    create(request: PtyCreateRequest): Promise<PtyCreateResponse>
    write(ptyId: string, data: string): Promise<void>
    resize(ptyId: string, cols: number, rows: number): Promise<void>
    kill(ptyId: string): Promise<void>
    /**
     * Snapshot of every live pty's id, for renderer-crash rehydration
     * (the React tree is gone but the main-process processes survive
     * a window reload). Slice 17.
     */
    list(): Promise<string[]>
    onData(cb: (event: PtyDataEvent) => void): () => void
    onExit(cb: (event: PtyExitEvent) => void): () => void
  }

  /**
   * Per-Project Sessions list + transcript reader. `list` returns
   * card summaries sorted newest-first; `readTranscript` streams one
   * Session's JSONL into user/assistant text rows. `onChanged` fires
   * whenever a `.jsonl` file under `~/.claude/projects/<encoded>/`
   * is added, removed, or modified.
   */
  sessions: {
    list(encodedPath: string): Promise<SessionSummary[]>
    readTranscript(encodedPath: string, sessionId: string): Promise<TranscriptEntry[]>
    onChanged(cb: (encodedPath: string) => void): () => void
  }

  /**
   * v5 / Slice 41: persistent notifications surface. The main-process
   * idle detector inserts rows when a live Pty Tab transitions from
   * active to idle while not foregrounded; the renderer reads them via
   * `list` and subscribes to lifecycle events via `onCreated` /
   * `onUpdated` / `onCleared`. `setForegroundPty` informs main of the
   * currently-foregrounded Pty Tab so it can suppress notifications
   * the user can already see.
   */
  notifications: {
    list(): Promise<Notification[]>
    markRead(id: string): Promise<void>
    markAllRead(opts?: { encodedPath?: string; sessionId?: string }): Promise<void>
    clearAll(opts?: { encodedPath?: string }): Promise<void>
    /** Pass `null` when no Pty Tab is foregrounded (Workspace hidden, etc.). */
    setForegroundPty(ptyId: string | null): Promise<void>
    /** Slice 43 (v5): global mute toggle. */
    getGlobalMute(): Promise<boolean>
    setGlobalMute(value: boolean): Promise<void>
    /** Slice 43 (v5): per-Project mute lookup. The setter lives on `projects.update`. */
    getProjectMute(encodedPath: string): Promise<boolean>
    onCreated(cb: (notification: Notification) => void): () => void
    onUpdated(cb: (event: { ids: string[] }) => void): () => void
    onCleared(cb: (event: { encodedPath: string | null }) => void): () => void
    /**
     * Slice 43 (v5): fires when either global or per-Project mute
     * changes. `scope: 'global'` carries the new boolean; `scope:
     * 'project'` carries the encodedPath + new boolean.
     */
    onMuteChanged(
      cb: (event:
        | { scope: 'global'; value: boolean }
        | { scope: 'project'; encodedPath: string; value: boolean }
      ) => void
    ): () => void
  }

  /**
   * v7 / Slice 51: account-global Claude Quota — the one ring-fenced,
   * opt-in networked feature (ADR-0011). `getSnapshot` returns the
   * current 5-hour + weekly windows, or `null` when the feature is
   * disabled, no Claude Code credential is present, or the fetch failed
   * (the renderer hides its chip on `null`). Reads/network happen only
   * while `isEnabled` is true; the OAuth token never crosses this
   * bridge — only the derived `QuotaSnapshot` does.
   */
  quota: {
    getSnapshot(): Promise<QuotaSnapshot | null>
    isEnabled(): Promise<boolean>
    setEnabled(value: boolean): Promise<void>
  }

  /**
   * v7 / Slice 52: the rebuildable Usage Events cache (ADR-0009). The
   * cache is populated by an async startup sweep and kept fresh by the
   * session watcher — the renderer only reads status and can force a
   * from-scratch `rebuild`. `onStatusChanged` drives the Home indexing
   * shimmer (Slice 54).
   */
  usage: {
    getStatus(): Promise<UsageIngestStatus>
    /** Wipe the cache + ingest cursors and re-sweep from scratch. */
    rebuild(): Promise<void>
    onStatusChanged(cb: (status: UsageIngestStatus) => void): () => void
    /** Aggregate Notional Cost across all Usage Events (Slice 53). */
    getCostSummary(): Promise<CostSummary>
    /**
     * Everything the Usage dashboard renders — totals + per-day series
     * (Slice 54). The optional Usage Filter (v10 / ADR-0013) re-scopes the
     * filtered views; omit it for the all-time / all-project view.
     */
    getDashboard(filter?: UsageDashboardFilter): Promise<UsageDashboard>
    /** Per-turn drill-down for one Session in the explorer (Slice 55). */
    getSessionEvents(sessionId: string): Promise<UsageTurn[]>
    /** One Project's headline Usage for its Project Screen strip (Slice 56). */
    getProjectSummary(encodedPath: string): Promise<UsageProjectSummary>
  }
}
