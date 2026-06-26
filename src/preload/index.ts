import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { MeshApi } from '@shared/api'
import type { PtyDataEvent, PtyExitEvent } from '@shared/pty'

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
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value)
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
  }
}

contextBridge.exposeInMainWorld('api', api)
