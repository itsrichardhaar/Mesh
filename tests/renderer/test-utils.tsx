import type { Mock } from 'vitest'
import { vi } from 'vitest'
import type { MeshApi } from '@shared/api'
import type { PtyDataEvent, PtyExitEvent } from '@shared/pty'
import type { Notification, ProviderId, UsageIngestStatus } from '@shared/types'

/**
 * Typed fake of the preload `window.api` surface (Slice 45 / v6).
 *
 * The renderer equivalent of the main process's injectable-dependency
 * convention: every method is a `vi.fn` with a benign default (empty
 * lists, `null`s, `'claude'`), overridable per test via the standard
 * mock API (`meshApi().projects.list.mockResolvedValue([...])`).
 * Methods whose return shape is too rich to fake honestly reject with
 * a "not stubbed" error naming the override to write.
 *
 * Event channels main would push over IPC are exposed as emitters:
 * `meshEmit().notificationCreated(buildNotification())` drives every
 * live subscriber exactly the way the real preload bridge would. Wrap
 * emits that cause React state updates in `act(...)`.
 *
 * A fresh fake is installed before every renderer test by
 * tests/renderer/setup.ts — overrides and subscriptions never leak
 * between tests.
 */

type MockedFn<F> = F extends (...args: infer A) => infer R ? Mock<(...args: A) => R> : never
export type Mocked<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? MockedFn<T[K]> : Mocked<T[K]>
}
export type MeshApiMock = Mocked<MeshApi>

class Channel<T> {
  private readonly listeners = new Set<(arg: T) => void>()

  readonly subscribe = (cb: (arg: T) => void): (() => void) => {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  readonly emit = (arg: T): void => {
    for (const cb of [...this.listeners]) cb(arg)
  }
}

export type MuteChangedEvent =
  | { scope: 'global'; value: boolean }
  | { scope: 'project'; encodedPath: string; value: boolean }

export interface MeshEmitters {
  menuOpenSettings: (arg?: undefined) => void
  menuCloseRequested: (arg?: undefined) => void
  menuBack: (arg?: undefined) => void
  menuToggleHidden: (arg?: undefined) => void
  activeProviderChanged: (provider: ProviderId) => void
  modelChanged: (key: string) => void
  fileTreeChanged: (encodedPath: string) => void
  sessionsChanged: (encodedPath: string) => void
  ptyData: (event: PtyDataEvent) => void
  ptyExit: (event: PtyExitEvent) => void
  notificationCreated: (notification: Notification) => void
  notificationsUpdated: (event: { ids: string[] }) => void
  notificationsCleared: (event: { encodedPath: string | null }) => void
  muteChanged: (event: MuteChangedEvent) => void
  usageStatusChanged: (status: UsageIngestStatus) => void
}

export interface MeshApiFake {
  api: MeshApiMock
  emit: MeshEmitters
}

function notStubbed(name: string): () => Promise<never> {
  return async () => {
    throw new Error(
      `window.api.${name} is not stubbed — give it an implementation in your test, e.g. meshApi().${name}.mockResolvedValue(...)`
    )
  }
}

export function createMeshApiFake(): MeshApiFake {
  const menuOpenSettings = new Channel<undefined>()
  const menuCloseRequested = new Channel<undefined>()
  const menuBack = new Channel<undefined>()
  const menuToggleHidden = new Channel<undefined>()
  const activeProviderChanged = new Channel<ProviderId>()
  const modelChanged = new Channel<string>()
  const fileTreeChanged = new Channel<string>()
  const sessionsChanged = new Channel<string>()
  const ptyData = new Channel<PtyDataEvent>()
  const ptyExit = new Channel<PtyExitEvent>()
  const notificationCreated = new Channel<Notification>()
  const notificationsUpdated = new Channel<{ ids: string[] }>()
  const notificationsCleared = new Channel<{ encodedPath: string | null }>()
  const muteChanged = new Channel<MuteChangedEvent>()
  const usageStatusChanged = new Channel<UsageIngestStatus>()

  const api: MeshApi = {
    ping: vi.fn(async () => 'pong'),
    projects: {
      list: vi.fn(async () => []),
      update: vi.fn(async () => undefined),
      stats: vi.fn(notStubbed('projects.stats'))
    },
    menu: {
      onOpenSettings: vi.fn((cb: () => void) => menuOpenSettings.subscribe(cb)),
      onCloseRequested: vi.fn((cb: () => void) => menuCloseRequested.subscribe(cb)),
      onBack: vi.fn((cb: () => void) => menuBack.subscribe(cb)),
      onToggleHidden: vi.fn((cb: () => void) => menuToggleHidden.subscribe(cb))
    },
    window: {
      close: vi.fn()
    },
    settings: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
      getActiveProvider: vi.fn(async (): Promise<ProviderId> => 'claude'),
      setActiveProvider: vi.fn(async () => undefined),
      onActiveProviderChanged: vi.fn(activeProviderChanged.subscribe),
      onModelChanged: vi.fn(modelChanged.subscribe)
    },
    theme: {
      setSource: vi.fn()
    },
    secrets: {
      available: vi.fn(async () => false),
      set: vi.fn(async () => undefined),
      getMask: vi.fn(async () => null),
      clear: vi.fn(async () => undefined),
      validate: vi.fn(notStubbed('secrets.validate')),
      getLastValidation: vi.fn(async () => null)
    },
    shell: {
      openExternal: vi.fn(async () => undefined)
    },
    analyses: {
      latest: vi.fn(async () => null),
      run: vi.fn(notStubbed('analyses.run'))
    },
    files: {
      tree: vi.fn(notStubbed('files.tree')),
      onTreeChanged: vi.fn(fileTreeChanged.subscribe),
      read: vi.fn(notStubbed('files.read'))
    },
    sessions: {
      list: vi.fn(async () => []),
      readTranscript: vi.fn(async () => []),
      onChanged: vi.fn(sessionsChanged.subscribe)
    },
    pty: {
      create: vi.fn(notStubbed('pty.create')),
      write: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      kill: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
      onData: vi.fn(ptyData.subscribe),
      onExit: vi.fn(ptyExit.subscribe)
    },
    notifications: {
      list: vi.fn(async () => []),
      markRead: vi.fn(async () => undefined),
      markAllRead: vi.fn(async () => undefined),
      clearAll: vi.fn(async () => undefined),
      setForegroundPty: vi.fn(async () => undefined),
      getGlobalMute: vi.fn(async () => false),
      setGlobalMute: vi.fn(async () => undefined),
      getProjectMute: vi.fn(async () => false),
      onCreated: vi.fn(notificationCreated.subscribe),
      onUpdated: vi.fn(notificationsUpdated.subscribe),
      onCleared: vi.fn(notificationsCleared.subscribe),
      onMuteChanged: vi.fn(muteChanged.subscribe)
    },
    quota: {
      getSnapshot: vi.fn(async () => null),
      isEnabled: vi.fn(async () => false),
      setEnabled: vi.fn(async () => undefined)
    },
    usage: {
      getStatus: vi.fn(async () => ({ state: 'idle' as const, eventCount: 0 })),
      rebuild: vi.fn(async () => undefined),
      onStatusChanged: vi.fn(usageStatusChanged.subscribe)
    }
  }

  return {
    api: api as MeshApiMock,
    emit: {
      menuOpenSettings: () => menuOpenSettings.emit(undefined),
      menuCloseRequested: () => menuCloseRequested.emit(undefined),
      menuBack: () => menuBack.emit(undefined),
      menuToggleHidden: () => menuToggleHidden.emit(undefined),
      activeProviderChanged: activeProviderChanged.emit,
      modelChanged: modelChanged.emit,
      fileTreeChanged: fileTreeChanged.emit,
      sessionsChanged: sessionsChanged.emit,
      ptyData: ptyData.emit,
      ptyExit: ptyExit.emit,
      notificationCreated: notificationCreated.emit,
      notificationsUpdated: notificationsUpdated.emit,
      notificationsCleared: notificationsCleared.emit,
      muteChanged: muteChanged.emit,
      usageStatusChanged: usageStatusChanged.emit
    }
  }
}

let current: MeshApiFake | null = null

/** Install a fresh fake as `window.api`. Called by setup.ts before every test. */
export function installMeshApi(): MeshApiFake {
  current = createMeshApiFake()
  window.api = current.api
  return current
}

function requireCurrent(): MeshApiFake {
  if (!current) {
    throw new Error('No MeshApi fake installed — is tests/renderer/setup.ts in setupFiles?')
  }
  return current
}

/** The currently-installed api fake, typed with vi.fn mock members. */
export function meshApi(): MeshApiMock {
  return requireCurrent().api
}

/** Emitters that push events to the current fake's subscribers, as main would over IPC. */
export function meshEmit(): MeshEmitters {
  return requireCurrent().emit
}

/** Notification fixture with deterministic defaults; override what the test cares about. */
export function buildNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'notif-0000',
    createdAt: '2026-07-07T12:00:00.000Z',
    encodedPath: '-Users-example-Desktop-Demo',
    sessionId: 'aaaabbbb-cccc-dddd-eeee-ffff00001111',
    ptyId: 'pty-0000',
    kind: 'idle',
    labelText: 'Agent is idle',
    readAt: null,
    ...overrides
  }
}
