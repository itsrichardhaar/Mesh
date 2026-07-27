import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FileReadResponse, FilesTreeRequest, FilesTreeResponse } from '@shared/files'
import type { SessionSummary, TranscriptEntry } from '@shared/sessions'
import type {
  Project,
  ProjectPatch,
  ProjectStats,
  ProviderId,
  StoredAnalysis,
  StoredValidation,
  UsageDashboardFilter,
  UsageTimeframe,
  ValidationResult
} from '@shared/types'
import { isProviderId, isThemePreference, isUsageTimeframe } from '@shared/types'
import { isModelId, selectedModelSettingKey } from '@shared/models'
import {
  ClaudeClient,
  humanizeAnthropicError,
  SchemaViolationError
} from './models/claude-client'
import { humanizeOpenAIError, OpenAIClient } from './models/openai-client'
import type { ModelClient } from '@shared/types'
import type { PtyCreateRequest, PtyCreateResponse } from '@shared/pty'
import { AnalysisOrchestrator } from './analyses/orchestrator'
import { insertAnalysis, latestForProject } from './analyses/repository'
import { resolveClaudeBinary } from './pty/claude-resolver'
import { PtyManager } from './pty/manager'
import { getDatabase, initDatabase } from './db'
import { runMigrations } from './db/migrations'
import { IdleDetector } from './notifications/idle-detector'
import {
  clearAll as clearAllNotifications,
  deleteOlderThan as deleteOldNotifications,
  listNotifications,
  markAllRead as markAllNotificationsRead,
  markRead as markNotificationRead
} from './notifications/repository'
import { FileReadError, readProjectFile } from './files/file-reader'
import {
  closeAll as closeAllWatchers,
  listDirectory,
  watchProject
} from './files/file-tree-service'
import { buildApplicationMenu } from './menu'
import { listProjects } from './projects/enumerator'
import { detect } from './projects/metadata-detector'
import {
  getSourcePath,
  isProjectMuted,
  readAugmentation,
  updateProject,
  upsertDetectedMetadata,
  upsertDiscovered
} from './projects/repository'
import { compute as computeStats } from './projects/stats-computer'
import { listSessions, readTranscript } from './sessions/session-reader'
import {
  closeAllSessionWatchers,
  watchSessions
} from './sessions/session-watcher'
import {
  clearSecret,
  EncryptionBackend,
  getMaskedSecret,
  getSecret,
  SecretsVaultUnavailableError,
  setSecret
} from './secrets/vault'
import {
  getActiveProvider,
  getGlobalNotificationsMute,
  getKindToastEnabled,
  getQuotaEnabled,
  getSetting,
  setActiveProvider,
  setGlobalNotificationsMute,
  setQuotaEnabled,
  setSetting
} from './settings/repository'
import { QuotaService, httpFetchUsage } from './quota/service'
import { FALLBACK_CLAUDE_VERSION, claudeCodeVersion, readOauthToken } from './quota/credential'
import { ingestProject, projectDirNames } from './usage/ingest'
import {
  countSessionsInMonth,
  projectMeta,
  projectUsageCounts,
  sessionEventRows,
  sessionMeta,
  sumTokensByDayAndGroup,
  sumTokensByGroupForProject,
  sumTokensByGroup,
  sumTokensByProjectGroup,
  sumTokensBySessionGroup,
  usageEventCount,
  usageSummaryCounts,
  wipeAllUsage
} from './usage/repository'
import { notionalCost } from './usage/cost'
import {
  buildDayPoints,
  buildModelRows,
  buildProjectRows,
  buildSessionRows,
  buildTurns
} from './usage/dashboard'
import { resolveTimeframe } from './usage/timeframe'

/** How many top Sessions by Usage the dashboard's session explorer shows. */
/**
 * Safety backstop for the Usage sessions table (v10 / Slice 71): the
 * filter (Project + Timeframe) usually bounds the set well under this;
 * the cap only bites on the widest "All / All time" view, where the UI
 * shows a "showing N of M" note.
 */
const SESSIONS_BACKSTOP = 500
import type Database from 'better-sqlite3'

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects')

const __dirname = fileURLToPath(new URL('.', import.meta.url))

let mainWindow: BrowserWindow | null = null
let isQuitting = false
const ptyManager = new PtyManager()

/**
 * v5 / Slice 41: notification subsystem. The idle detector watches each
 * Pty Tab's activity stream and fires `notifications:created` events
 * when a live tab transitions to idle while not foregrounded. Lazily
 * constructed in `app.whenReady` so the database exists first.
 */
let idleDetector: IdleDetector | null = null

/**
 * v7 / Slice 51: networked Claude Quota (ADR-0011). Opt-in, off by
 * default; the service gates its own credential read + fetch on the
 * `quota_enabled` setting. Lazily constructed in `app.whenReady`.
 */
let quotaService: QuotaService | null = null

/**
 * Cached `User-Agent` for the quota fetch (`claude-code/<version>`).
 * Resolved once, lazily, on the first enabled fetch — resolving the
 * Claude binary + running `--version` is subprocess work we don't want
 * to repeat per call.
 */
let quotaUserAgent: string | null = null

/**
 * v7 / Slice 52: Usage ingest state. `usageIndexing` is true while the
 * startup sweep or a Rebuild is running; the renderer's Home shimmer
 * (Slice 54) reflects it. The cache itself lives in SQLite (ADR-0009).
 */
let usageIndexing = false

/** Days of notification history retained — older rows swept at boot. */
const NOTIFICATION_RETENTION_DAYS = 7

const usageNow = (): string => new Date().toISOString()

/** Push the current Usage ingest status to the renderer (shimmer + count). */
function emitUsageStatus(): void {
  mainWindow?.webContents.send('usage:status-changed', {
    state: usageIndexing ? 'indexing' : 'idle',
    eventCount: usageEventCount(getDatabase())
  })
}

/**
 * Sweep every Project into the Usage cache, yielding between Projects so
 * the main thread stays responsive (better-sqlite3 + fs are synchronous;
 * yielding keeps the UI from freezing during a large first sweep). Runs
 * after first paint, so launch is never blocked.
 */
async function runUsageSweep(db: Database.Database): Promise<void> {
  usageIndexing = true
  emitUsageStatus()
  try {
    for (const encodedPath of projectDirNames(CLAUDE_PROJECTS_DIR)) {
      ingestProject(db, CLAUDE_PROJECTS_DIR, encodedPath, usageNow)
      await new Promise((resolve) => setImmediate(resolve))
    }
  } finally {
    usageIndexing = false
    emitUsageStatus()
  }
}

// In production builds, `electron-builder` embeds `build/icon.icns` into the
// `.app` bundle (configured in `electron-builder.yml`), so the dock icon
// comes from CFBundleIconFile automatically. In dev (`pnpm dev`), Electron
// uses its default app icon unless we set one explicitly — `app.dock.setIcon`
// covers macOS, and `BrowserWindow({ icon })` covers Linux/Windows.
const APP_ICON_PATH = join(__dirname, '../../build/icon.png')

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    icon: APP_ICON_PATH,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Hide on close (macOS productivity-app idiom); ⌘Q triggers actual quit.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function smokeTestSafeStorage(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[mesh] safeStorage encryption not available on this system')
    return
  }
  try {
    const plaintext = 'mesh-smoke-test'
    const encrypted = safeStorage.encryptString(plaintext)
    const decrypted = safeStorage.decryptString(encrypted)
    if (decrypted !== plaintext) {
      console.error('[mesh] safeStorage round-trip mismatch')
    }
  } catch (err) {
    console.error('[mesh] safeStorage smoke test threw:', err)
  }
}

function registerIpc(): void {
  ipcMain.handle('ping', () => 'pong')

  // Renderer asks the window to close — same path the red-X uses, which
  // our `close` listener intercepts to hide the window on macOS.
  ipcMain.on('window:close', () => {
    mainWindow?.close()
  })

  ipcMain.handle('projects:list', async (): Promise<Project[]> => {
    const discovered = await listProjects(CLAUDE_PROJECTS_DIR)
    const db = getDatabase()
    upsertDiscovered(db, discovered)

    // Run detection for any Project missing cached metadata; Source-Missing
    // Projects are skipped because their canonical files are unreachable.
    const augBefore = readAugmentation(db)
    const needsDetection = discovered.filter(
      (p) => !p.sourceMissing && augBefore.get(p.encodedPath)?.lastMetadataDetectedAt == null
    )
    if (needsDetection.length > 0) {
      const detectedAt = new Date().toISOString()
      await Promise.all(
        needsDetection.map(async (p) => {
          try {
            const meta = await detect(p.sourcePath)
            upsertDetectedMetadata(db, p.encodedPath, meta, detectedAt)
          } catch (err) {
            console.warn(`[mesh] metadata detection failed for ${p.encodedPath}:`, err)
          }
        })
      )
    }

    const augmentation = readAugmentation(db)
    return discovered.map((p) => {
      const aug = augmentation.get(p.encodedPath)
      return {
        ...p,
        name: aug?.autoName ?? p.name,
        autoSubtitle: aug?.autoSubtitle ?? null,
        hidden: aug?.hidden ?? false,
        muteNotifications: aug?.muteNotifications ?? false
      }
    })
  })

  ipcMain.handle(
    'projects:update',
    (_event, encodedPath: unknown, patch: unknown): void => {
      if (typeof encodedPath !== 'string' || encodedPath.length === 0) {
        throw new Error('projects:update: encodedPath must be a non-empty string')
      }
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('projects:update: patch must be an object')
      }
      const typedPatch = patch as ProjectPatch
      updateProject(getDatabase(), encodedPath, typedPatch)
      // Slice 43 (v5): emit a mute-changed event when the patch toggled
      // per-Project mute. Renderer subscribers (notifications hook,
      // context menu) react without needing a separate IPC round-trip.
      if (typedPatch.muteNotifications !== undefined) {
        mainWindow?.webContents.send('notifications:mute-changed', {
          scope: 'project',
          encodedPath,
          value: typedPatch.muteNotifications
        })
      }
    }
  )

  ipcMain.handle(
    'projects:stats',
    async (_event, encodedPath: unknown): Promise<ProjectStats> => {
      if (typeof encodedPath !== 'string' || encodedPath.length === 0) {
        throw new Error('projects:stats: encodedPath must be a non-empty string')
      }
      return computeStats(join(CLAUDE_PROJECTS_DIR, encodedPath))
    }
  )

  ipcMain.handle('settings:get', (_event, key: unknown): string | null => {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('settings:get: key must be a non-empty string')
    }
    return getSetting(getDatabase(), key)
  })

  ipcMain.handle(
    'settings:set',
    (_event, key: unknown, value: unknown): void => {
      if (typeof key !== 'string' || key.length === 0) {
        throw new Error('settings:set: key must be a non-empty string')
      }
      if (typeof value !== 'string') {
        throw new Error('settings:set: value must be a string')
      }
      setSetting(getDatabase(), key, value)
      // Slice 36: any per-Provider model selection change (e.g. `model:claude`,
      // `model:openai`) emits so the Analyze button subtitle can update live.
      // The cached-validation snapshot keys (`model:<provider>:validation`)
      // are intentionally excluded — they're persistence, not a user-visible
      // choice. The Active Provider key has its own dedicated channel below.
      if (/^model:(claude|openai|local)$/.test(key)) {
        mainWindow?.webContents.send('settings:model-changed', key)
      }
    }
  )

  ipcMain.handle('settings:get-active-provider', (): ProviderId => {
    return getActiveProvider(getDatabase())
  })

  ipcMain.handle(
    'settings:set-active-provider',
    (_event, provider: unknown): void => {
      if (!isProviderId(provider)) {
        throw new Error('settings:set-active-provider: provider must be a known ProviderId')
      }
      setActiveProvider(getDatabase(), provider)
      // Live-update subscribers (Settings → Model pill row, Analyze button
      // subtitle) — see Slice 36 implementation notes.
      mainWindow?.webContents.send('settings:active-provider-changed', provider)
    }
  )

  // Renderer notifies main when the user's theme preference changes so
  // nativeTheme can update macOS chrome (title bar tint, vibrancy, etc.)
  // in lock-step with the in-app palette.
  ipcMain.on('theme:set-source', (_event, source: unknown) => {
    if (isThemePreference(source)) {
      nativeTheme.themeSource = source
    }
  })

  ipcMain.handle('secrets:available', (): boolean => {
    return safeStorage.isEncryptionAvailable()
  })

  ipcMain.handle(
    'secrets:set',
    (_event, provider: unknown, plaintext: unknown): void => {
      if (!isProviderId(provider)) {
        throw new Error('secrets:set: provider must be a known ProviderId')
      }
      if (typeof plaintext !== 'string' || plaintext.length === 0) {
        throw new Error('secrets:set: plaintext must be a non-empty string')
      }
      try {
        setSecret(getDatabase(), encryptionBackend, secretKey(provider), plaintext)
      } catch (err) {
        if (err instanceof SecretsVaultUnavailableError) {
          throw new Error('Encryption is unavailable on this system; secret not saved')
        }
        throw err
      }
    }
  )

  ipcMain.handle(
    'secrets:get-mask',
    (_event, provider: unknown): string | null => {
      if (!isProviderId(provider)) {
        throw new Error('secrets:get-mask: provider must be a known ProviderId')
      }
      try {
        return getMaskedSecret(getDatabase(), encryptionBackend, secretKey(provider))
      } catch (err) {
        if (err instanceof SecretsVaultUnavailableError) {
          // A stored blob exists but we can't decrypt it — surface a
          // distinct, recoverable error rather than silently hiding it.
          throw new Error('Encryption is unavailable on this system; cannot read stored secret')
        }
        throw err
      }
    }
  )

  ipcMain.handle('secrets:clear', (_event, provider: unknown): void => {
    if (!isProviderId(provider)) {
      throw new Error('secrets:clear: provider must be a known ProviderId')
    }
    clearSecret(getDatabase(), secretKey(provider))
    // Drop the cached validation record so the next mount doesn't
    // show "✓ Connected" for a key that no longer exists.
    setSetting(getDatabase(), validationKey(provider), '')
  })

  ipcMain.handle(
    'secrets:validate',
    async (_event, provider: unknown): Promise<ValidationResult> => {
      if (!isProviderId(provider)) {
        throw new Error('secrets:validate: provider must be a known ProviderId')
      }
      if (provider === 'local') {
        // Local stays a stub; surface the same envelope so the renderer's
        // switch is uniform.
        return { ok: false, message: 'Provider not available' }
      }
      const db = getDatabase()
      let plaintext: string | null
      try {
        plaintext = getSecret(db, encryptionBackend, secretKey(provider))
      } catch (err) {
        if (err instanceof SecretsVaultUnavailableError) {
          return { ok: false, message: 'Encryption unavailable; cannot read stored key' }
        }
        throw err
      }
      if (!plaintext) {
        return { ok: false, message: 'No API key saved' }
      }
      const client: ModelClient = buildValidationClient(db, provider, plaintext)
      const result = await client.validate()
      const stored: StoredValidation = {
        at: new Date().toISOString(),
        ok: result.ok,
        ...(result.message ? { message: result.message } : {})
      }
      setSetting(db, validationKey(provider), JSON.stringify(stored))
      return result
    }
  )

  ipcMain.handle(
    'secrets:get-last-validation',
    (_event, provider: unknown): StoredValidation | null => {
      if (!isProviderId(provider)) {
        throw new Error('secrets:get-last-validation: provider must be a known ProviderId')
      }
      const raw = getSetting(getDatabase(), validationKey(provider))
      if (!raw) return null
      try {
        const parsed = JSON.parse(raw) as unknown
        if (
          parsed &&
          typeof parsed === 'object' &&
          typeof (parsed as Record<string, unknown>).at === 'string' &&
          typeof (parsed as Record<string, unknown>).ok === 'boolean'
        ) {
          return parsed as StoredValidation
        }
      } catch {
        // Fall through to null — a malformed record is not fatal.
      }
      return null
    }
  )

  ipcMain.handle('shell:open-external', async (_event, url: unknown): Promise<void> => {
    if (typeof url !== 'string' || url.length === 0) {
      throw new Error('shell:open-external: url must be a non-empty string')
    }
    // Allowlist: only http(s) URLs may be opened externally. Anything
    // else (file://, javascript:, custom schemes) is refused — a
    // compromised renderer shouldn't be able to launch arbitrary
    // handlers via this IPC.
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('shell:open-external: only http(s) URLs are allowed')
    }
    await shell.openExternal(url)
  })

  ipcMain.handle(
    'analyses:latest',
    (_event, encodedPath: unknown): StoredAnalysis | null => {
      if (typeof encodedPath !== 'string' || encodedPath.length === 0) {
        throw new Error('analyses:latest: encodedPath must be a non-empty string')
      }
      return latestForProject(getDatabase(), encodedPath)
    }
  )

  ipcMain.handle(
    'analyses:run',
    async (_event, encodedPath: unknown): Promise<StoredAnalysis> => {
      if (typeof encodedPath !== 'string' || encodedPath.length === 0) {
        throw new Error('analyses:run: encodedPath must be a non-empty string')
      }
      const db = getDatabase()

      // Resolve the Project shape from current enumerator state — we
      // need name, source path, and source-missing flag for the
      // orchestrator. Cheaper than re-listing the whole tree.
      const sourcePath = getSourcePath(db, encodedPath)
      if (!sourcePath) {
        throw new Error(`analyses:run: unknown encodedPath ${encodedPath}`)
      }
      const all = await listProjects(CLAUDE_PROJECTS_DIR)
      const base = all.find((p) => p.encodedPath === encodedPath)
      if (!base) {
        throw new Error(`analyses:run: project ${encodedPath} no longer enumerated`)
      }
      const aug = readAugmentation(db).get(encodedPath)
      const project = {
        ...base,
        name: aug?.autoName ?? base.name,
        autoSubtitle: aug?.autoSubtitle ?? null,
        hidden: aug?.hidden ?? false,
        muteNotifications: aug?.muteNotifications ?? false
      }

      // Slice 36: resolve which Provider's client to use from the
      // Active Provider setting. Mismatches between Active Provider
      // and stored keys surface here as preflight errors per the
      // existing Slice 12 error envelope.
      const activeProvider = getActiveProvider(db)
      if (activeProvider === 'local') {
        throw new Error(
          'Local provider is not yet available. Switch to Claude or OpenAI in Settings → Model.'
        )
      }
      let plaintextKey: string | null
      try {
        plaintextKey = getSecret(db, encryptionBackend, secretKey(activeProvider))
      } catch (err) {
        if (err instanceof SecretsVaultUnavailableError) {
          throw new Error('Encryption unavailable; cannot read stored key')
        }
        throw err
      }
      if (!plaintextKey) {
        const keyLabel = activeProvider === 'openai' ? 'OpenAI' : 'Anthropic'
        throw new Error(`No ${keyLabel} API key saved. Add one in Settings → Model.`)
      }
      const client = buildValidationClient(db, activeProvider, plaintextKey)
      const provider = activeProvider
      const model = client.model

      const orchestrator = new AnalysisOrchestrator({
        claudeProjectsDir: CLAUDE_PROJECTS_DIR,
        loadPriorAnalysis: async (key) => latestForProject(db, key)
      })

      const generatedAt = new Date().toISOString()
      try {
        const result = await orchestrator.run(project, client)
        insertAnalysis(db, {
          encodedPath,
          generatedAt,
          status: 'ok',
          provider,
          model,
          sourceSessionCount: result.sourceSessionCount,
          lastAnalyzedSha: result.lastAnalyzedSha,
          content: result.output
        })
      } catch (err) {
        // Orchestrator / model failures persist as a status='failed'
        // row so the renderer can render the error banner via the
        // same `analyses:latest` read path used by ok rows. The full
        // error is logged to the main-process console for debugging;
        // only the humanized message reaches the user.
        console.error('[mesh] analyses:run failed:', err)
        insertAnalysis(db, {
          encodedPath,
          generatedAt,
          status: 'failed',
          errorMessage: humanizeAnalyzeError(err, provider),
          provider,
          model
        })
      }

      const stored = latestForProject(db, encodedPath)
      if (!stored) {
        throw new Error('analyses:run: persisted analysis disappeared')
      }
      return stored
    }
  )

  ipcMain.handle(
    'sessions:list',
    async (_event, encodedPath: unknown): Promise<SessionSummary[]> => {
      if (typeof encodedPath !== 'string' || encodedPath.length === 0) {
        throw new Error('sessions:list: encodedPath must be a non-empty string')
      }
      const projectDir = join(CLAUDE_PROJECTS_DIR, encodedPath)
      // First touch subscribes the watcher so subsequent jsonl writes
      // surface in the renderer; idempotent under repeat. Slice 52 (v7):
      // the same signal tail-ingests this Project's new turns into the
      // Usage cache, so an open Project stays fresh live.
      watchSessions(encodedPath, projectDir, () => {
        mainWindow?.webContents.send('sessions:changed', encodedPath)
        ingestProject(getDatabase(), CLAUDE_PROJECTS_DIR, encodedPath, usageNow)
        emitUsageStatus()
      })
      return listSessions(projectDir)
    }
  )

  ipcMain.handle(
    'sessions:read-transcript',
    async (
      _event,
      encodedPath: unknown,
      sessionId: unknown
    ): Promise<TranscriptEntry[]> => {
      if (typeof encodedPath !== 'string' || encodedPath.length === 0) {
        throw new Error('sessions:read-transcript: encodedPath must be a non-empty string')
      }
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new Error('sessions:read-transcript: sessionId must be a non-empty string')
      }
      return readTranscript(join(CLAUDE_PROJECTS_DIR, encodedPath), sessionId)
    }
  )

  ipcMain.handle(
    'pty:create',
    async (_event, request: unknown): Promise<PtyCreateResponse> => {
      if (request === null || typeof request !== 'object' || Array.isArray(request)) {
        throw new Error('pty:create: request must be an object')
      }
      const req = request as PtyCreateRequest
      if (typeof req.encodedPath !== 'string' || req.encodedPath.length === 0) {
        throw new Error('pty:create: encodedPath must be a non-empty string')
      }
      if (typeof req.sessionId !== 'string' || req.sessionId.length === 0) {
        throw new Error('pty:create: sessionId must be a non-empty string')
      }
      const cols = Number.isFinite(req.cols) && req.cols > 0 ? Math.floor(req.cols) : 80
      const rows = Number.isFinite(req.rows) && req.rows > 0 ? Math.floor(req.rows) : 24

      const sourcePath = getSourcePath(getDatabase(), req.encodedPath)
      if (!sourcePath) {
        return {
          ok: false,
          code: 'project-not-found',
          message: `Unknown project ${req.encodedPath}`
        }
      }

      // Source-Missing projects can't host a Pty Tab — the cwd no
      // longer exists. Resolve the claude binary in the same step so
      // the user sees one banner per failure mode.
      const stat = await import('node:fs/promises').then((m) => m.stat(sourcePath).catch(() => null))
      if (!stat || !stat.isDirectory()) {
        return {
          ok: false,
          code: 'source-missing',
          message: `Source path no longer exists: ${sourcePath}`
        }
      }
      const claudeBin = await resolveClaudeBinary()
      if (!claudeBin) {
        return {
          ok: false,
          code: 'claude-not-found',
          message:
            'The `claude` CLI was not found on PATH. Install Claude Code from claude.com/claude-code, then try Resume again.'
        }
      }

      const ptyId = ptyManager.create({
        command: claudeBin,
        args: ['--resume', req.sessionId],
        cwd: sourcePath,
        cols,
        rows,
        onData: (id, data) => {
          mainWindow?.webContents.send('pty:data', { ptyId: id, data })
          idleDetector?.onPtyData(id, data)
        },
        onExit: (id, exitCode) => {
          mainWindow?.webContents.send('pty:exit', { ptyId: id, exitCode })
          idleDetector?.onPtyExit(id)
        }
      })
      // Slice 41 (v5): register the PTY's metadata with the idle
      // detector so subsequent activity / exit events can be
      // attributed to the right Project + Session. Unregistration
      // happens automatically inside `onPtyExit`.
      idleDetector?.registerPty(ptyId, req.encodedPath, req.sessionId)
      return { ok: true, ptyId }
    }
  )

  ipcMain.handle('pty:write', (_event, ptyId: unknown, data: unknown): void => {
    if (typeof ptyId !== 'string' || ptyId.length === 0) {
      throw new Error('pty:write: ptyId must be a non-empty string')
    }
    if (typeof data !== 'string') {
      throw new Error('pty:write: data must be a string')
    }
    ptyManager.write(ptyId, data)
  })

  ipcMain.handle(
    'pty:resize',
    (_event, ptyId: unknown, cols: unknown, rows: unknown): void => {
      if (typeof ptyId !== 'string' || ptyId.length === 0) {
        throw new Error('pty:resize: ptyId must be a non-empty string')
      }
      if (typeof cols !== 'number' || typeof rows !== 'number') {
        throw new Error('pty:resize: cols and rows must be numbers')
      }
      ptyManager.resize(ptyId, cols, rows)
    }
  )

  ipcMain.handle('pty:kill', (_event, ptyId: unknown): void => {
    if (typeof ptyId !== 'string' || ptyId.length === 0) {
      throw new Error('pty:kill: ptyId must be a non-empty string')
    }
    ptyManager.kill(ptyId)
  })

  ipcMain.handle('pty:list', (): string[] => {
    return ptyManager.list()
  })

  ipcMain.handle(
    'files:tree',
    async (
      _event,
      encodedPath: unknown,
      request: unknown
    ): Promise<FilesTreeResponse> => {
      if (typeof encodedPath !== 'string' || encodedPath.length === 0) {
        throw new Error('files:tree: encodedPath must be a non-empty string')
      }
      const req = (request ?? {}) as FilesTreeRequest
      const relPath = typeof req.relPath === 'string' ? req.relPath : ''
      const showHidden = req.showHidden === true

      const sourcePath = getSourcePath(getDatabase(), encodedPath)
      if (!sourcePath) {
        throw new Error(`files:tree: unknown encodedPath ${encodedPath}`)
      }

      // Subscribe chokidar on first access so the renderer gets live
      // events without an explicit "open project" call; the existing-
      // watcher path inside watchProject is idempotent under repeat.
      watchProject(encodedPath, sourcePath, () => {
        mainWindow?.webContents.send('files:tree-changed', encodedPath)
      })

      const entries = await listDirectory(sourcePath, relPath, showHidden)
      return { sourcePath, relPath, entries }
    }
  )

  ipcMain.handle(
    'files:read',
    async (_event, encodedPath: unknown, relPath: unknown): Promise<FileReadResponse> => {
      if (typeof encodedPath !== 'string' || encodedPath.length === 0) {
        throw new Error('files:read: encodedPath must be a non-empty string')
      }
      if (typeof relPath !== 'string' || relPath.length === 0) {
        throw new Error('files:read: relPath must be a non-empty string')
      }
      const sourcePath = getSourcePath(getDatabase(), encodedPath)
      if (!sourcePath) {
        throw new Error(`files:read: unknown encodedPath ${encodedPath}`)
      }
      try {
        const result = await readProjectFile(sourcePath, relPath)
        return { ok: true, ...result }
      } catch (err) {
        if (err instanceof FileReadError) {
          return { ok: false, code: err.code, message: err.message, relPath }
        }
        throw err
      }
    }
  )

  // --- Notifications (Slice 41, v5) ---------------------------------------

  ipcMain.handle('notifications:list', () => {
    return listNotifications(getDatabase())
  })

  ipcMain.handle('notifications:mark-read', (_event, id: unknown): void => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('notifications:mark-read: id must be a non-empty string')
    }
    const at = new Date().toISOString()
    const { updated } = markNotificationRead(getDatabase(), id, at)
    if (updated.length > 0) {
      mainWindow?.webContents.send('notifications:updated', { ids: updated })
    }
  })

  ipcMain.handle(
    'notifications:mark-all-read',
    (
      _event,
      opts: unknown
    ): void => {
      const scope =
        opts && typeof opts === 'object'
          ? (opts as { encodedPath?: unknown; sessionId?: unknown })
          : {}
      const encodedPath =
        typeof scope.encodedPath === 'string' && scope.encodedPath.length > 0
          ? scope.encodedPath
          : undefined
      const sessionId =
        typeof scope.sessionId === 'string' && scope.sessionId.length > 0
          ? scope.sessionId
          : undefined
      const at = new Date().toISOString()
      const { updated } = markAllNotificationsRead(
        getDatabase(),
        { encodedPath, sessionId },
        at
      )
      if (updated.length > 0) {
        mainWindow?.webContents.send('notifications:updated', { ids: updated })
      }
    }
  )

  ipcMain.handle('notifications:clear-all', (_event, opts: unknown): void => {
    const scope =
      opts && typeof opts === 'object' ? (opts as { encodedPath?: unknown }) : {}
    const encodedPath =
      typeof scope.encodedPath === 'string' && scope.encodedPath.length > 0
        ? scope.encodedPath
        : undefined
    const { cleared } = clearAllNotifications(getDatabase(), { encodedPath })
    if (cleared > 0) {
      mainWindow?.webContents.send('notifications:cleared', { encodedPath: encodedPath ?? null })
    }
  })

  ipcMain.handle(
    'notifications:set-foreground-pty',
    (_event, ptyId: unknown): void => {
      if (ptyId !== null && (typeof ptyId !== 'string' || ptyId.length === 0)) {
        throw new Error('notifications:set-foreground-pty: ptyId must be a non-empty string or null')
      }
      idleDetector?.setForegroundPty(ptyId as string | null)
    }
  )

  // Slice 43 (v5): mute controls. Two surfaces, one detector — both
  // read by the configureMuteCheck closure on every fire so toggles
  // apply instantly. Renderer subscribes to `notifications:mute-changed`
  // so the Settings checkbox + dropdown quick-action + per-Project
  // popover stay in sync.

  ipcMain.handle('notifications:get-global-mute', (): boolean => {
    return getGlobalNotificationsMute(getDatabase())
  })

  ipcMain.handle('notifications:set-global-mute', (_event, value: unknown): void => {
    if (typeof value !== 'boolean') {
      throw new Error('notifications:set-global-mute: value must be a boolean')
    }
    setGlobalNotificationsMute(getDatabase(), value)
    mainWindow?.webContents.send('notifications:mute-changed', {
      scope: 'global',
      value
    })
  })

  ipcMain.handle('notifications:get-project-mute', (_event, encodedPath: unknown): boolean => {
    if (typeof encodedPath !== 'string' || encodedPath.length === 0) {
      throw new Error('notifications:get-project-mute: encodedPath must be a non-empty string')
    }
    return isProjectMuted(getDatabase(), encodedPath)
  })

  // --- Quota (v7 / Slice 51, ADR-0011) ------------------------------------
  // `get-snapshot` returns null (chip hidden) whenever disabled, no
  // credential, or the fetch failed — the service enforces the opt-in
  // gate, so no keychain/network access occurs while disabled.
  ipcMain.handle('quota:get-snapshot', () => quotaService?.getSnapshot() ?? null)

  ipcMain.handle('quota:is-enabled', (): boolean => getQuotaEnabled(getDatabase()))

  ipcMain.handle('quota:set-enabled', (_event, value: unknown): void => {
    if (typeof value !== 'boolean') {
      throw new Error('quota:set-enabled: value must be a boolean')
    }
    setQuotaEnabled(getDatabase(), value)
  })

  // --- Usage cache (v7 / Slice 52, ADR-0009) ------------------------------
  ipcMain.handle('usage:get-status', () => ({
    state: usageIndexing ? 'indexing' : 'idle',
    eventCount: usageEventCount(getDatabase())
  }))

  // Rebuild wipes the cache + cursors and re-sweeps from scratch — the
  // drop-and-rebuild path that proves the cache is purely derived.
  ipcMain.handle('usage:rebuild', async (): Promise<void> => {
    const db = getDatabase()
    wipeAllUsage(db)
    emitUsageStatus()
    await runUsageSweep(db)
  })

  // Notional Cost across all Usage Events (Slice 53, ADR-0010). Computed
  // on read from the pricing table — never stored, so a price change
  // takes effect without touching the cache.
  ipcMain.handle('usage:get-cost-summary', () => {
    const { totalUsd, unpricedModels } = notionalCost(sumTokensByGroup(getDatabase()))
    return { totalNotionalCostUsd: totalUsd, unpricedModels }
  })

  // Everything the global Usage dashboard needs in one round-trip
  // (Slice 54); v10 (ADR-0013) makes the views filterable via an optional
  // { timeframe, encodedPath } argument. The filtered views (days / byModel
  // / byProject / topSessions) honor it; `summary` and `heatmapDays` stay
  // global. metric + granularity are applied client-side and never re-fetch.
  ipcMain.handle('usage:get-dashboard', (_event, arg: unknown) => {
    const db = getDatabase()
    const req = (arg ?? {}) as Partial<UsageDashboardFilter>
    const timeframe: UsageTimeframe = isUsageTimeframe(req.timeframe) ? req.timeframe : 'all'
    const encodedPath =
      typeof req.encodedPath === 'string' && req.encodedPath.length > 0 ? req.encodedPath : null
    const range = resolveTimeframe(timeframe, new Date())
    const filter = { start: range.start, end: range.end, encodedPath }

    // Global summary — the Metric Cards are unaffected by the Usage Filter.
    const counts = usageSummaryCounts(db)
    const cost = notionalCost(sumTokensByGroup(db))
    // Filtered sessions, most-recent-first (Slice 71) — computed once so
    // the full count feeds `sessionsTotal` before the backstop slice.
    const sessionRows = sessionMeta(db, filter)
    return {
      summary: {
        eventCount: counts.eventCount,
        sessionCount: counts.sessionCount,
        sessionsThisMonth: countSessionsInMonth(db, new Date().toISOString().slice(0, 7)),
        totalTokens: counts.totalTokens,
        totalNotionalCostUsd: cost.totalUsd,
        unpricedModels: cost.unpricedModels
      },
      // Filtered views.
      days: buildDayPoints(sumTokensByDayAndGroup(db, filter)),
      byProject: buildProjectRows(sumTokensByProjectGroup(db, filter), projectMeta(db, filter)),
      byModel: buildModelRows(sumTokensByGroup(db, filter)),
      // Sessions most-recent-first; `topSessions` is capped at a safety
      // backstop, `sessionsTotal` is the full filtered count (Slice 71).
      topSessions: buildSessionRows(sumTokensBySessionGroup(db, filter), sessionRows, SESSIONS_BACKSTOP),
      sessionsTotal: sessionRows.length,
      // Global — the rolling-year Activity Heatmap ignores the filter.
      heatmapDays: buildDayPoints(sumTokensByDayAndGroup(db))
    }
  })

  // Per-turn drill-down for one Session (Slice 55).
  ipcMain.handle('usage:get-session-events', (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('usage:get-session-events: sessionId must be a non-empty string')
    }
    return buildTurns(sessionEventRows(getDatabase(), sessionId))
  })

  // One Project's headline Usage — the Project Screen strip (Slice 56).
  ipcMain.handle('usage:get-project-summary', (_event, encodedPath: unknown) => {
    if (typeof encodedPath !== 'string' || encodedPath.length === 0) {
      throw new Error('usage:get-project-summary: encodedPath must be a non-empty string')
    }
    const db = getDatabase()
    const counts = projectUsageCounts(db, encodedPath)
    const cost = notionalCost(sumTokensByGroupForProject(db, encodedPath))
    return { ...counts, costUsd: cost.totalUsd }
  })
}

/** Stable SQLite key shape for per-Provider secrets. */
function secretKey(provider: ProviderId): string {
  return `secret:${provider}`
}

/** Stable SQLite key shape for the cached validation outcome per Provider. */
function validationKey(provider: ProviderId): string {
  return `model:${provider}:validation`
}

/**
 * Returns the `ModelClient` to use for a `validate()` probe of the
 * given Provider. Reads the user's selected model from settings, falling
 * back to each Provider's recommended default. Local is rejected upstream
 * (no functional client); this helper only dispatches Claude vs OpenAI.
 *
 * Slice 35 keeps the analyze path's client selection hardcoded to Claude —
 * Slice 36's Active Provider switching wires the same factory pattern
 * into the orchestrator.
 */
function buildValidationClient(
  db: ReturnType<typeof getDatabase>,
  provider: Exclude<ProviderId, 'local'>,
  plaintext: string
): ModelClient {
  const modelId = getSetting(db, selectedModelSettingKey(provider))
  if (provider === 'openai') {
    const model = isModelId(modelId) ? modelId : 'gpt-4o-mini'
    return new OpenAIClient(model, plaintext)
  }
  const model = isModelId(modelId) ? modelId : 'claude-haiku-4-5'
  return new ClaudeClient(model, plaintext)
}

/**
 * Translate any orchestrator/model failure into a short, human-facing
 * string for the `error_message` column. Routes status-bearing SDK
 * errors through the active Provider's humanizer (Anthropic / OpenAI
 * map slightly different status codes to different canned strings);
 * schema-violation failures get a dedicated, actionable message
 * instead of leaking Zod's path string.
 */
function humanizeAnalyzeError(err: unknown, provider: ProviderId): string {
  if (err instanceof SchemaViolationError) {
    return 'The model returned an invalid format after one retry. Try again, or pick a different Model in Settings.'
  }
  if (err && typeof err === 'object' && 'status' in (err as Record<string, unknown>)) {
    return provider === 'openai'
      ? humanizeOpenAIError(err)
      : humanizeAnthropicError(err)
  }
  if (err instanceof Error && err.message.length > 0) {
    return err.message.length > 200 ? err.message.slice(0, 197) + '…' : err.message
  }
  return 'Analysis failed for an unknown reason.'
}

const encryptionBackend: EncryptionBackend = {
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (plaintext) => safeStorage.encryptString(plaintext),
  decryptString: (ciphertext) => safeStorage.decryptString(ciphertext)
}

/**
 * Apply the persisted theme to `nativeTheme` before any window opens so
 * the title bar paints in the right palette on first frame. Falls back
 * to `system` when no preference is recorded.
 */
function applyPersistedTheme(): void {
  const stored = getSetting(getDatabase(), 'theme')
  nativeTheme.themeSource = isThemePreference(stored) ? stored : 'system'
}

app.whenReady().then(() => {
  // macOS dev-mode dock icon. Production bundles get their icon from
  // electron-builder's `mac.icon` config, so `app.dock.setIcon` is a no-op
  // there but harmless. Wrapped in try/catch because the dock module is
  // macOS-only — calling it on other platforms throws.
  if (process.platform === 'darwin' && app.dock) {
    try {
      app.dock.setIcon(APP_ICON_PATH)
    } catch {
      // Non-fatal: the dock will fall back to Electron's default icon.
    }
  }

  const db = initDatabase()
  runMigrations(db)
  smokeTestSafeStorage()

  // Slice 41 (v5): wire the notification subsystem. The idle detector
  // emits via `mainWindow.webContents.send` (resolved lazily because
  // the window doesn't exist yet at this point). 7-day retention
  // sweep runs once at boot so the table stays small without user
  // intervention.
  idleDetector = new IdleDetector({
    db,
    now: () => Date.now(),
    scheduleTimeout: (cb, ms) => setTimeout(cb, ms),
    cancelTimeout: (timer) => clearTimeout(timer as NodeJS.Timeout),
    emit: (channel, payload) => mainWindow?.webContents.send(channel, payload),
    generateId: () => randomUUID()
  })
  // Slice 43 (v5): mute-check reads live state from SQLite on each
  // fire so toggle changes apply immediately without any cache
  // invalidation. Storage still happens unconditionally inside the
  // detector — only the toast event is suppressed.
  idleDetector.configureMuteCheck(() => ({
    global: getGlobalNotificationsMute(db),
    project: (encodedPath: string) => isProjectMuted(db, encodedPath),
    kindEnabled: (kind) => getKindToastEnabled(db, kind)
  }))
  const retentionCutoff = new Date(
    Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()
  const { cleared: retentionCleared } = deleteOldNotifications(db, retentionCutoff)
  if (retentionCleared > 0) {
    console.log(`[mesh] notifications: retention sweep cleared ${retentionCleared} rows older than ${NOTIFICATION_RETENTION_DAYS} days`)
  }

  // Slice 51 (v7): networked Claude Quota (ADR-0011). The service gates
  // its own credential read + fetch on `quota_enabled` — nothing
  // outbound happens until the user opts in.
  quotaUserAgent = `claude-code/${FALLBACK_CLAUDE_VERSION}`
  quotaService = new QuotaService({
    isEnabled: () => getQuotaEnabled(db),
    readToken: () => readOauthToken(),
    fetchUsage: httpFetchUsage,
    userAgent: () => quotaUserAgent ?? `claude-code/${FALLBACK_CLAUDE_VERSION}`,
    now: () => Date.now()
  })
  // Refine the User-Agent with the real Claude Code version once (async,
  // cached). The endpoint rejects the shared low rate-limit bucket
  // without a plausible claude-code UA; the fallback covers any fetch
  // that races this resolution.
  void resolveClaudeBinary().then((bin) => {
    quotaUserAgent = `claude-code/${claudeCodeVersion(bin)}`
  })

  registerIpc()
  applyPersistedTheme()
  buildApplicationMenu(() => mainWindow)
  createWindow()

  // Slice 52 (v7): populate the Usage cache after the window exists, so
  // the sweep never blocks first paint. Yields between Projects; the
  // renderer sees `indexing` until it settles (ADR-0009).
  void runUsageSweep(db)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      mainWindow?.show()
    }
  })
}).catch((err) => {
  // Without this, a throw in initDatabase / runMigrations / registerIpc leaves
  // the app with a menu bar but no window — the unhandled rejection vanishes
  // and the user has no idea why nothing opened. Surface it and quit cleanly.
  const message = err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err)
  console.error('[main] fatal init error:', message)
  dialog.showErrorBox('Mesh failed to start', message)
  app.exit(1)
})

app.on('window-all-closed', () => {
  // On macOS, the app stays alive in the dock when all windows close.
  // On other platforms, that gesture means "quit".
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  // If any pty is still alive, ask before SIGTERM'ing them — the
  // user might have a long-running Claude session they don't want to
  // interrupt. The confirm only runs once: after the user picks
  // "Quit anyway", `isQuitting` is set and subsequent before-quit
  // events (which Electron fires per window-close) take the fast path.
  if (!isQuitting) {
    const live = ptyManager.list()
    if (live.length > 0 && mainWindow) {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        buttons: ['Cancel', 'Quit anyway'],
        defaultId: 0,
        cancelId: 0,
        title: 'Active Claude sessions',
        message: `Mesh has ${live.length} active Claude session${live.length === 1 ? '' : 's'}. Quit anyway?`,
        detail: 'Active work will be interrupted.'
      })
      if (choice !== 1) {
        event.preventDefault()
        return
      }
    }
  }
  isQuitting = true
  void closeAllWatchers()
  void closeAllSessionWatchers()
  ptyManager.closeAll()
  idleDetector?.shutdown()
})
