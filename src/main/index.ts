import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } from 'electron'
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
  ValidationResult
} from '@shared/types'
import { isProviderId, isThemePreference } from '@shared/types'
import { isModelId, selectedModelSettingKey } from '@shared/models'
import {
  ClaudeClient,
  humanizeAnthropicError,
  SchemaViolationError
} from './models/claude-client'
import type { PtyCreateRequest, PtyCreateResponse } from '@shared/pty'
import { AnalysisOrchestrator } from './analyses/orchestrator'
import { insertAnalysis, latestForProject } from './analyses/repository'
import { resolveClaudeBinary } from './pty/claude-resolver'
import { PtyManager } from './pty/manager'
import { getDatabase, initDatabase } from './db'
import { runMigrations } from './db/migrations'
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
import { getSetting, setSetting } from './settings/repository'

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects')

const __dirname = fileURLToPath(new URL('.', import.meta.url))

let mainWindow: BrowserWindow | null = null
let isQuitting = false
const ptyManager = new PtyManager()

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
        hidden: aug?.hidden ?? false
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
      updateProject(getDatabase(), encodedPath, patch as ProjectPatch)
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
      if (provider !== 'claude') {
        // OpenAI and Local don't ship a functional client in v1; surface
        // the same shape so the renderer's switch is uniform.
        return { ok: false, message: 'Provider not available in v1' }
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
      const modelId = getSetting(db, selectedModelSettingKey(provider))
      const model = isModelId(modelId) ? modelId : 'claude-haiku-4-5'
      const client = new ClaudeClient(model, plaintext)
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
        hidden: aug?.hidden ?? false
      }

      // Load the user's selected model + decrypted key.
      let plaintextKey: string | null
      try {
        plaintextKey = getSecret(db, encryptionBackend, secretKey('claude'))
      } catch (err) {
        if (err instanceof SecretsVaultUnavailableError) {
          throw new Error('Encryption unavailable; cannot read stored key')
        }
        throw err
      }
      if (!plaintextKey) {
        throw new Error('No Anthropic API key saved. Add one in Settings → Model.')
      }
      const modelSetting = getSetting(db, selectedModelSettingKey('claude'))
      const model = isModelId(modelSetting) ? modelSetting : 'claude-haiku-4-5'
      const client = new ClaudeClient(model, plaintextKey)

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
          provider: 'claude',
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
          errorMessage: humanizeAnalyzeError(err),
          provider: 'claude',
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
      // surface in the renderer; idempotent under repeat.
      watchSessions(encodedPath, projectDir, () => {
        mainWindow?.webContents.send('sessions:changed', encodedPath)
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
        },
        onExit: (id, exitCode) => {
          mainWindow?.webContents.send('pty:exit', { ptyId: id, exitCode })
        }
      })
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
 * Translate any orchestrator/model failure into a short, human-facing
 * string for the `error_message` column. Anthropic SDK errors route
 * through the existing humanizer; schema-violation failures get a
 * dedicated, actionable message instead of leaking Zod's path string.
 */
function humanizeAnalyzeError(err: unknown): string {
  if (err instanceof SchemaViolationError) {
    return 'The model returned an invalid format after one retry. Try again, or pick a different Model in Settings.'
  }
  if (err && typeof err === 'object' && 'status' in (err as Record<string, unknown>)) {
    return humanizeAnthropicError(err)
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
  registerIpc()
  applyPersistedTheme()
  buildApplicationMenu(() => mainWindow)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      mainWindow?.show()
    }
  })
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
})
