// IPC contract surface exposed to the renderer via the preload bridge.
// Every method here corresponds to a registered `ipcMain.handle` in src/main.

import type { FileReadResponse, FilesTreeRequest, FilesTreeResponse } from './files'
import type { SessionSummary, TranscriptEntry } from './sessions'
import type {
  Project,
  ProjectPatch,
  ProjectStats,
  ProviderId,
  StoredAnalysis,
  ThemePreference
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
  }

  /**
   * Persistent history of LLM-generated Analyses. Slice 10's
   * orchestrator writes rows; the renderer reads `latest` on Project
   * selection so existing Analyses render without requiring a fresh
   * Analyze click.
   */
  analyses: {
    latest(encodedPath: string): Promise<StoredAnalysis | null>
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
}
