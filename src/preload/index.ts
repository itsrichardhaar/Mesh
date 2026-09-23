import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { MeshApi } from '@shared/api'
import type { PtyDataEvent, PtyExitEvent } from '@shared/pty'
import type { Notification, ProviderId, UsageIngestStatus } from '@shared/types'

function subscribe(channel: string, cb: () => void): () => void {
  const handler = (): void => cb()
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

function subscribeArg<T>(channel: string, cb: (arg: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, arg: T): void => cb(arg)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: MeshApi = {
  ping: () => ipcRenderer.invoke('ping'),
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    update: (encodedPath, patch) => ipcRenderer.invoke('projects:update', encodedPath, patch),
    stats: (encodedPath) => ipcRenderer.invoke('projects:stats', encodedPath)
  },
  menu: {
    onOpenSettings: (cb) => subscribe('menu:open-settings', cb),
    onCloseRequested: (cb) => subscribe('menu:close-requested', cb),
    onBack: (cb) => subscribe('menu:back', cb),
    onToggleHidden: (cb) => subscribe('menu:toggle-hidden', cb)
  },
  window: {
    close: () => ipcRenderer.send('window:close')
  },
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    getActiveProvider: () => ipcRenderer.invoke('settings:get-active-provider'),
    setActiveProvider: (provider) =>
      ipcRenderer.invoke('settings:set-active-provider', provider),
    onActiveProviderChanged: (cb) =>
      subscribeArg<ProviderId>('settings:active-provider-changed', cb),
    onModelChanged: (cb) => subscribeArg<string>('settings:model-changed', cb)
  },
  theme: {
    setSource: (source) => ipcRenderer.send('theme:set-source', source)
  },
  secrets: {
    available: () => ipcRenderer.invoke('secrets:available'),
    set: (provider, plaintext) => ipcRenderer.invoke('secrets:set', provider, plaintext),
    getMask: (provider) => ipcRenderer.invoke('secrets:get-mask', provider),
    clear: (provider) => ipcRenderer.invoke('secrets:clear', provider),
    validate: (provider) => ipcRenderer.invoke('secrets:validate', provider),
    getLastValidation: (provider) =>
      ipcRenderer.invoke('secrets:get-last-validation', provider)
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url)
  },
  analyses: {
    latest: (encodedPath) => ipcRenderer.invoke('analyses:latest', encodedPath),
    run: (encodedPath) => ipcRenderer.invoke('analyses:run', encodedPath)
  },
  files: {
    tree: (encodedPath, request) =>
      ipcRenderer.invoke('files:tree', encodedPath, request ?? {}),
    onTreeChanged: (cb) => subscribeArg<string>('files:tree-changed', cb),
    read: (encodedPath, relPath) => ipcRenderer.invoke('files:read', encodedPath, relPath)
  },
  sessions: {
    list: (encodedPath) => ipcRenderer.invoke('sessions:list', encodedPath),
    readTranscript: (encodedPath, sessionId) =>
      ipcRenderer.invoke('sessions:read-transcript', encodedPath, sessionId),
    onChanged: (cb) => subscribeArg<string>('sessions:changed', cb)
  },
  pty: {
    create: (request) => ipcRenderer.invoke('pty:create', request),
    write: (ptyId, data) => ipcRenderer.invoke('pty:write', ptyId, data),
    resize: (ptyId, cols, rows) => ipcRenderer.invoke('pty:resize', ptyId, cols, rows),
    kill: (ptyId) => ipcRenderer.invoke('pty:kill', ptyId),
    list: () => ipcRenderer.invoke('pty:list'),
    onData: (cb) => subscribeArg<PtyDataEvent>('pty:data', cb),
    onExit: (cb) => subscribeArg<PtyExitEvent>('pty:exit', cb)
  },
  notifications: {
    list: () => ipcRenderer.invoke('notifications:list'),
    markRead: (id) => ipcRenderer.invoke('notifications:mark-read', id),
    markAllRead: (opts) => ipcRenderer.invoke('notifications:mark-all-read', opts ?? {}),
    clearAll: (opts) => ipcRenderer.invoke('notifications:clear-all', opts ?? {}),
    setForegroundPty: (ptyId) => ipcRenderer.invoke('notifications:set-foreground-pty', ptyId),
    getGlobalMute: () => ipcRenderer.invoke('notifications:get-global-mute'),
    setGlobalMute: (value) => ipcRenderer.invoke('notifications:set-global-mute', value),
    getProjectMute: (encodedPath) =>
      ipcRenderer.invoke('notifications:get-project-mute', encodedPath),
    onCreated: (cb) => subscribeArg<Notification>('notifications:created', cb),
    onUpdated: (cb) => subscribeArg<{ ids: string[] }>('notifications:updated', cb),
    onCleared: (cb) => subscribeArg<{ encodedPath: string | null }>('notifications:cleared', cb),
    onMuteChanged: (cb) =>
      subscribeArg<
        | { scope: 'global'; value: boolean }
        | { scope: 'project'; encodedPath: string; value: boolean }
      >('notifications:mute-changed', cb)
  },
  quota: {
    getSnapshot: () => ipcRenderer.invoke('quota:get-snapshot'),
    isEnabled: () => ipcRenderer.invoke('quota:is-enabled'),
    setEnabled: (value) => ipcRenderer.invoke('quota:set-enabled', value)
  },
  usage: {
    getStatus: () => ipcRenderer.invoke('usage:get-status'),
    rebuild: () => ipcRenderer.invoke('usage:rebuild'),
    onStatusChanged: (cb) => subscribeArg<UsageIngestStatus>('usage:status-changed', cb),
    getCostSummary: () => ipcRenderer.invoke('usage:get-cost-summary'),
    getDashboard: (filter) => ipcRenderer.invoke('usage:get-dashboard', filter),
    getSessionEvents: (sessionId) => ipcRenderer.invoke('usage:get-session-events', sessionId),
    getSessionSummary: (encodedPath, sessionId) =>
      ipcRenderer.invoke('usage:get-session-summary', encodedPath, sessionId),
    getProjectSummary: (encodedPath) => ipcRenderer.invoke('usage:get-project-summary', encodedPath)
  }
}

contextBridge.exposeInMainWorld('api', api)
